const _ = require('lodash');
import { SearchSourceProvider } from 'ui/courier/data_source/search_source';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import { onDashboardPage } from 'ui/kibi/utils/on_page';
import utils from 'plugins/enhanced_tilemap/utils';
import { VislibVisTypeBuildChartDataProvider } from 'ui/vislib_vis_type/build_chart_data';
import { getMarkerClusteringPrecision,
  processAggRespForMarkerClustering } from './../../vislib/marker_cluster_helper';

//react modal
import React from 'react';
import { modalWithForm } from '../modals/genericModal';
import { render, unmountComponentAtNode } from 'react-dom';
import {
  EuiFormRow,
  EuiSelect,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem
} from '@elastic/eui';

import EsLayer from './EsLayer';

define(function (require) {
  return function POIsFactory(Private, savedSearches, joinExplanation, createNotifier) {

    const SearchSource = Private(SearchSourceProvider);
    const geoFilter = Private(require('plugins/enhanced_tilemap/vislib/geoFilter'));
    const queryFilter = Private(FilterBarQueryFilterProvider);
    const RespProcessor = require('plugins/enhanced_tilemap/resp_processor');
    const buildChartData = Private(VislibVisTypeBuildChartDataProvider);
    const createEsLayer = new EsLayer();
    const notify = createNotifier({
      location: 'Enhanced Coordinate Map'
    });

    /**
     * Points of Interest
     *
     * Turns saved search results into easily consumible data for leaflet.
     */
    function POIs(params) {
      this.params = params;
      this.isInitialDragAndDrop = params.isInitialDragAndDrop;
      this.savedSearchId = params.savedSearchId;
      this.draggedState = params.draggedState;
      this.geoField = params.geoField || undefined;
      //remain backwards compatible
      if (!params.geoField && params.geoPointField) {
        this.geoField = params.geoPointField;
      }
      this.popupFields = _.get(params, 'popupFields', []).map(function (obj) {
        return obj.name;
      });
      this.limit = _.get(params, 'limit', 250);
      this.syncFilters = _.get(params, 'syncFilters', false);
    }

    function getGeoFields(savedSearch) {
      const geoFields = [];
      savedSearch.searchSource._state.index.fields.forEach(field => {
        if (field.esType === 'geo_point' ||
          field.esType === 'geo_shape') {
          geoFields.push({ type: field.esType, name: field.name });
        }
      });
      return geoFields;
    }

    function createMapExtentFilter(rect) {
      const bounds = rect.geo_bounding_box.geo_bounding_box;
      return geoFilter.rectFilter(rect.geoField.fieldname, rect.geoField.geotype, bounds.top_left, bounds.bottom_right);
    }

    /**
     * @param {options} options: styling options
     * @param {Function} callback(layer)
          layer {ILayer}: Leaflet Layer containing the results of the saved search
     */
    POIs.prototype.getLayer = async function (options, callback) {
      /**
       * @param {object} searchSource: A valid searchSource, typically taken from main vis
       * @param {object} savedSearch: A valid savedSearch, can be any saved search with geo_point
       *                               field present configured in vis.params
       * @param {object} geo: an object containing the field and type of the configured geofield
       * @param {boolean} isAgg: a boolean to indicate if an aggregation query is required
       */
      const createSearchSource = async (searchSource, savedSearch, geo, queryType, docFilters) => {
        let allFilters = [createMapExtentFilter(options.mapExtentFilter)];

        if (this.draggedState) {
          //For drag and drop overlays
          if (this.isInitialDragAndDrop) {
            //Use filters from search drag and drop
            searchSource.inherits(false);
            searchSource.index(this.draggedState.index);
            searchSource.query(this.draggedState.query[0]);

            allFilters = allFilters.concat(this.draggedState.filters);

            //adding html of filters from dragged dashboard
            options.filterPopupContent =
              await Promise.resolve(joinExplanation.constructFilterIconMessage(allFilters, this.draggedState.query));


          } else {
            //When drag and drop layer already exists, i.e. ES response watcher
            searchSource.inherits(false);
            searchSource.index(this.params.draggedStateInitial.index);
            searchSource.query(this.params.draggedStateInitial.query[0]);
            this.params.draggedStateInitial.filters.shift(); // remove previous map extent filter
            allFilters = allFilters.concat(this.params.draggedStateInitial.filters);
            options.filterPopupContent = this.params.filterPopupContent; //adding filter popup content from drop
          }
        } else {
          //For non drag and drop overlays
          if (this.syncFilters) {
            // POI layers can be based on any search so searchSource
            // inherits from the savedSearch search source instead of main
            searchSource.inherits(savedSearch.searchSource);
            //_siren from main searchSource is used
            searchSource._siren = options._siren;

            if (onDashboardPage()) {
              allFilters = allFilters.concat(...searchSource.filter());
            } else {
              allFilters = allFilters.concat(...queryFilter.getFilters());
            }

          } else {
            //Do not filter POIs by time so can not inherit from rootSearchSource
            searchSource.inherits(false);
            searchSource.index(savedSearch.searchSource._state.index);
            searchSource.query(savedSearch.searchSource.get('query'));
          }
        }

        if (docFilters) {
          allFilters.push(docFilters);
        }
        searchSource.filter(allFilters);

        if (queryType === 'agg') {
          searchSource.size(0);
          searchSource.aggs(function () {
            options.vis.requesting();
            options.dsl[2].aggs.filtered_geohash.geohash_grid.precision = getMarkerClusteringPrecision(options.zoom);
            return options.dsl;
          });
        } else {
          searchSource.size(this.limit || 250);
        }
        searchSource.source({
          includes: _.compact(_.flatten([geo.field, options.popupFields])),
          excludes: []
        });
        return searchSource;
      };

      const fetchData = async (searchSource) => {
        try {
          options.setCurrentTimeFilter(searchSource);
          return await searchSource.fetch();
        } catch (e) {
          notify.warning(`Unsuccessful POI fetch request - ${e}`);
        }
      };

      const savedSearch = await savedSearches.get(this.savedSearchId);
      const geoFields = getGeoFields(savedSearch);
      const geoField = geoFields.find(geoField => {
        return geoField.name === options.geoFieldName;
      });

      const geo = {};
      if (this.params.geoField && this.params.geoType) {
        geo.type = this.params.geoType;
        geo.field = this.params.geoField;
      } else if (geoField) {
        geo.type = geoField.type;
        geo.field = geoField.name;
      } else if (geoFields.length === 1) {
        geo.type = geoFields[0].type;
        geo.field = geoFields[0].name;
      }

      const processLayer = async () => {
        options.popupFields = this.popupFields;
        //creating icon and title from search for map and layerControl
        options.displayName = options.displayName || savedSearch.title;

        // geo_shape color search color used for drag and drop or geo_point types
        options.icon = savedSearch.siren.ui.icon;

        if (this.draggedState) {
          options.close = true;
        }

        let docResp;
        let processedAggResp = {
          aggFeatures: []
        };
        options.color = savedSearch.siren.ui.color;
        if (geo.type === 'geo_point') {
          this.params.type = 'poi_point';
          const aggSearchSource = await createSearchSource(new SearchSource(), savedSearch, geo, 'agg');
          const aggResp = await fetchData(aggSearchSource);

          if (_.get(aggResp, 'aggregations')) {
            const respProcessor = new RespProcessor(options.vis, buildChartData, utils);
            const aggChartData = respProcessor.process(aggResp);
            processedAggResp = processAggRespForMarkerClustering(aggChartData, geoFilter, this.limit, geo.field);
          }

          if (_.get(processedAggResp, 'docFilters.bool.should.length') >= 1) {
            const docSearchSource = await createSearchSource(new SearchSource(), savedSearch, geo, 'search', processedAggResp.docFilters);
            docResp = await fetchData(docSearchSource);
          }
        } else if (geo.type === 'geo_shape') {
          this.params.type = 'poi_shape';
          const docSearchSource = await createSearchSource(new SearchSource(), savedSearch, geo, 'search');
          docResp = await fetchData(docSearchSource);
        }
        const hits = _.get(docResp, 'hits.hits', []);

        if (this.draggedState) {
          //For drag and drop overlays
          //Storing this information on the drag and drop params object for subsequent renders
          if (this.isInitialDragAndDrop) {
            this.params.filterPopupContent = options.filterPopupContent;
            this.params.icon = options.icon;
            this.params.savedDashboardTitleInitial = this.params.savedDashboardTitle;
            this.params.draggedStateInitial = this.params.draggedState;
            this.params.geoField = geo.field;
            this.params.geoType = geo.type;
            this.params.displayName = options.displayName;
          }
        }

        return callback(createEsLayer.createLayer(hits, processedAggResp.aggFeatures, geo, 'poi', options));
      };

      const geoFieldSelectModal = () => {

        if (geoFields.length >= 2 && this.isInitialDragAndDrop) {

          this.options = [];
          _.each(geoFields, geoField => {
            this.options.push({ value: geoField.name, text: geoField.name });
          });

          function getGeoType(geoFieldName) {
            return _.find(geoFields, function (geoField) {
              return geoField.name === geoFieldName;
            });
          }

          const domNode = document.createElement('div');
          document.body.append(domNode);
          const title = 'Geo field selection';

          let selected = this.options[0].value;

          const onChange = e => {
            selected = e.target.value;
          };

          const form = (

            <EuiFlexGroup gutterSize="l" alignItems="flexEnd" justifyContent="spaceBetween" style={{ marginLeft: '0px' }}>
              <EuiFlexItem grow={true}>
                <EuiFormRow label="Select the Geo field for POI layer">
                  <EuiSelect
                    options={this.options}
                    onChange={onChange}
                    style={{ minWidth: '180px' }}
                  />
                </EuiFormRow>
              </EuiFlexItem>
            </EuiFlexGroup>
          );

          const onClose = () => {
            unmountComponentAtNode(domNode);
            document.body.removeChild(domNode);
          };

          const onConFirm = () => {
            geo.field = selected;
            geo.type = getGeoType(geo.field).type;
            processLayer();
          };

          const footer = (
            <EuiFlexGroup>
              <EuiFlexItem grow={false}>
                <EuiButton
                  size='s'
                  onClick={() => {
                    onClose();
                  }}
                >Cancel</EuiButton>
              </EuiFlexItem>

              <EuiFlexItem grow={false}>
                <EuiButton
                  fill
                  size='s'
                  onClick={() => {
                    onConFirm();
                    onClose();
                  }}
                >Confirm</EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          );

          render(
            modalWithForm(title, form, footer, onClose),
            domNode
          );
        }
      };

      //handling case where savedSearch is coming from vis params or drag and drop
      if (geo.field) {
        processLayer();
      } else {
        geoFieldSelectModal();
      }
    };
    return POIs;
  };
});
