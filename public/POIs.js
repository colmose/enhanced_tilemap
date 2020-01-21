const _ = require('lodash');
const L = require('leaflet');
import { searchIcon } from 'plugins/enhanced_tilemap/vislib/icons/searchIcon';
import { markerClusteringIcon } from 'plugins/enhanced_tilemap/vislib/icons/markerClusteringIcon';
import { toLatLng } from 'plugins/enhanced_tilemap/vislib/geo_point';
import { SearchSourceProvider } from 'ui/courier/data_source/search_source';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import utils from 'plugins/enhanced_tilemap/utils';
import { decodeGeoHash } from 'ui/utils/decode_geo_hash';
import { VislibVisTypeBuildChartDataProvider } from 'ui/vislib_vis_type/build_chart_data';

//react modal
import React from 'react';
import { modalWithForm } from './vislib/modals/genericModal';
import { render, unmountComponentAtNode } from 'react-dom';
import {
  EuiFormRow,
  EuiSelect,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem
} from '@elastic/eui';

define(function (require) {
  return function POIsFactory(Private, savedSearches, joinExplanation) {

    const SearchSource = Private(SearchSourceProvider);
    const queryFilter = Private(FilterBarQueryFilterProvider);
    const geoFilter = Private(require('plugins/enhanced_tilemap/vislib/geoFilter'));
    const RespProcessor = require('plugins/enhanced_tilemap/resp_processor');
    const buildChartData = Private(VislibVisTypeBuildChartDataProvider);
    require('./lib/leaflet.markercluster/leaflet.markercluster');

    const MAX_DOC_THRESHOLD = 1000;

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
      this.limit = _.get(params, 'limit', 100);
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

    const getParentWithClass = function (element, className) {
      let parent = element;
      while (parent != null) {
        if (parent.className && L.DomUtil.hasClass(parent, className)) {
          return parent;
        }
        parent = parent.parentNode;
      }
      return false;
    };


    /**
     * @param {options} options: styling options
     * @param {Function} callback(layer)
          layer {ILayer}: Leaflet ILayer containing the results of the saved search
     */
    POIs.prototype.getLayer = function (options, callback) {
      const self = this;
      savedSearches.get(this.savedSearchId).then(savedSearch => {
        const geoFields = getGeoFields(savedSearch);

        if (geoFields.length === 1) {
          this.geoField = geoFields[0].name;
          this.geoType = geoFields[0].type;
        }

        const processLayer = () => {

          //creating icon and title from search for map and layerControl
          options.displayName = options.displayName || savedSearch.title;

          // geo_shape color search color used for drag and drop or geo_point types
          options.searchIcon = savedSearch.siren.ui.icon;

          if (this.draggedState) {
            options.close = true;
            options.color = savedSearch.siren.ui.color;
          }

          let searchIcon;
          if (this.geoType === 'geo_point') {
            options.color = savedSearch.siren.ui.color;
            searchIcon = `<i class="${options.searchIcon}" style="color:${savedSearch.siren.ui.color};"></i>`;
          } else {
            //use square icon for geo_shape fields
            searchIcon = `<i class="far fa-stop" style="color:${options.color};"></i>`;
          }

          function createMapExtentFilter(rect) {
            const bounds = rect.geo_bounding_box.geoBoundingBox;
            return geoFilter.rectFilter(rect.geoField.fieldname, rect.geoField.geotype, bounds.top_left, bounds.bottom_right);
          }

          //********************************************************** */
          //Aggregation searchSource request
          const aggSearchSource = new SearchSource();

          let allFilters = [];
          if (this.draggedState) {
            //For drag and drop overlays
            if (this.isInitialDragAndDrop) {
              //Use filters from search drag and drop
              aggSearchSource.inherits(false);
              aggSearchSource.index(this.draggedState.index);
              aggSearchSource.query(this.draggedState.query[0]);
              allFilters = this.draggedState.filters;

              //adding html of filters from dragged dashboard
              Promise.resolve(joinExplanation.constructFilterIconMessage(allFilters, this.draggedState.query))
                .then(filterPopupContent => {
                  options.filterPopupContent = filterPopupContent;
                });

              allFilters.push(createMapExtentFilter(options.mapExtentFilter));
              aggSearchSource.filter(allFilters);
            } else {
              //When drag and drop layer already exists, i.e. ES response watcher
              aggSearchSource.inherits(false);
              aggSearchSource.index(this.params.draggedStateInitial.index);
              aggSearchSource.query(this.params.draggedStateInitial.query[0]);
              allFilters = this.params.draggedStateInitial.filters;
              allFilters.pop(); // remove previous map extent filter
              allFilters.push(createMapExtentFilter(options.mapExtentFilter));
              aggSearchSource.filter(allFilters);
              options.filterPopupContent = this.params.filterPopupContent; //adding filter popup content from drop
            }
            //for vis params overlays
          } else if (this.syncFilters) {
            aggSearchSource.inherits(savedSearch.searchSource);
            allFilters = queryFilter.getFilters();
            allFilters.push(createMapExtentFilter(options.mapExtentFilter));
            aggSearchSource.filter(allFilters);
          } else {
            //Do not filter POIs by time so can not inherit from rootSearchSource
            aggSearchSource.inherits(false);
            aggSearchSource.index(savedSearch.searchSource._state.index);
            aggSearchSource.query(savedSearch.searchSource.get('query'));
            allFilters = createMapExtentFilter(options.mapExtentFilter);
          }

          aggSearchSource.filter(allFilters);

          aggSearchSource.aggs(function () {
            options.vis.requesting();
            const precision = options.dsl[2].aggs.filtered_geohash.geohash_grid.precision;
            if (precision >= 3) options.dsl[2].aggs.filtered_geohash.geohash_grid.precision -= 1;
            return options.dsl;
          });
          aggSearchSource.source({
            includes: _.compact(_.flatten([this.geoField, this.popupFields])),
            excludes: []
          });

          // assigning the placeholder value of 1000 POIs in the
          // case where number in the limit field has been replaced with null
          // const poiLimitToDisplay = this.limit || 1000;

          // const tooManyDocsInfo = `<i class="fa fa-exclamation-triangle text-color-warning doc-viewer-underscore"></i>`;

          //Removal of previous too many documents warning when map is changed to a new extent
          options.$legend.innerHTML = '';

          aggSearchSource.fetch()
            .then(aggSearchResp => {

              const respProcessor = new RespProcessor(options.vis, buildChartData, utils);
              const aggChartData = respProcessor.process(aggSearchResp);
              //********************************************************** */
              //individual document searchSource request

              const individualDocFilters = {
                bool: {
                  should: []
                }
              };

              let totalNumberOfDocsToRetrieve = 0;
              options.aggFeatures = aggChartData.geoJson.features;
              for (let i = options.aggFeatures.length - 1; i >= 0; i--) {
                const documentsInCurrentFeature = options.aggFeatures[i].properties.value;
                if ((totalNumberOfDocsToRetrieve + documentsInCurrentFeature) < MAX_DOC_THRESHOLD) {

                  const rectangle = options.aggFeatures[i].properties.rectangle;
                  const topLeft = { lat: rectangle[3][0], lon: rectangle[3][1] };
                  const bottomRight = { lat: rectangle[1][0], lon: rectangle[1][1] };

                  const geoBoundingBoxFilter = geoFilter.rectFilter(this.geoField, 'geo_point', topLeft, bottomRight);
                  individualDocFilters.bool.should.push(geoBoundingBoxFilter);
                  totalNumberOfDocsToRetrieve += options.aggFeatures[i].properties.value;
                  options.aggFeatures.splice(i, 1);
                }
              }

              const docSearchSource = new SearchSource();
              let allFilters = [];
              if (this.draggedState) {
                //For drag and drop overlays
                if (this.isInitialDragAndDrop) {
                  //Use filters from search drag and drop
                  docSearchSource.inherits(false);
                  docSearchSource.index(this.draggedState.index);
                  docSearchSource.query(this.draggedState.query[0]);
                  allFilters = this.draggedState.filters;

                  //adding html of filters from dragged dashboard
                  Promise.resolve(joinExplanation.constructFilterIconMessage(allFilters, this.draggedState.query))
                    .then(filterPopupContent => {
                      options.filterPopupContent = filterPopupContent;
                    });

                  allFilters.push(createMapExtentFilter(options.mapExtentFilter));
                  //docSearchSource.filter(allFilters);
                } else {
                  //When drag and drop layer already exists, i.e. ES response watcher
                  docSearchSource.inherits(false);
                  docSearchSource.index(this.params.draggedStateInitial.index);
                  docSearchSource.query(this.params.draggedStateInitial.query[0]);
                  allFilters = this.params.draggedStateInitial.filters;
                  allFilters.pop(); // remove previous map extent filter
                  allFilters.push(createMapExtentFilter(options.mapExtentFilter));
                  //docSearchSource.filter(allFilters);
                  options.filterPopupContent = this.params.filterPopupContent; //adding filter popup content from drop
                }
                //for vis params overlays
              } else if (this.syncFilters) {
                docSearchSource.inherits(savedSearch.searchSource);
                allFilters = queryFilter.getFilters();
                allFilters.push(createMapExtentFilter(options.mapExtentFilter));
                //docSearchSource.filter(allFilters);
              } else {
                //Do not filter POIs by time so can not inherit from rootSearchSource
                docSearchSource.inherits(false);
                docSearchSource.index(savedSearch.searchSource._state.index);
                docSearchSource.query(savedSearch.searchSource.get('query'));
                allFilters.push(createMapExtentFilter(options.mapExtentFilter));
              }

              allFilters = allFilters.concat(individualDocFilters);

              docSearchSource.filter(allFilters);
              docSearchSource.size(MAX_DOC_THRESHOLD);

              docSearchSource.source({
                includes: _.compact(_.flatten([this.geoField, this.popupFields])),
                excludes: []
              });

              // docSearchSource.aggs(function () {
              //   options.vis.requesting();
              //   return options.dsl;
              // });

              docSearchSource.fetch()
                .then(docSearchResp => {

                  // if (searchResp.hits.total > this.limit) {
                  //   options.$legend.innerHTML = tooManyDocsInfo;
                  //   options.tooManyDocs = poiLimitToDisplay;
                  // };


                  //Too many documents warning for each specific layer
                  options.$legend.tooManyDocsInfo = '';
                  if (this.draggedState) {
                    options.$legend.searchIcon = `<i>${options.displayName}</i> ${searchIcon}`;
                  } else {
                    options.$legend.searchIcon = `${options.displayName} ${searchIcon}`;
                  }

                  //Storing this information on the params object for use
                  //in ES Response watcher
                  if (this.isInitialDragAndDrop) {
                    this.params.filterPopupContent = options.filterPopupContent;
                    this.params.searchIcon = options.$legend.searchIcon;
                    this.params.savedDashboardTitleInitial = this.params.savedDashboardTitle;
                    this.params.draggedStateInitial = this.params.draggedState;
                    this.params.geoField = this.geoField;
                    this.params.geoType = this.geoType;
                    this.params.displayName = options.displayName;
                  }

                  callback(self._createLayer(docSearchResp.hits.hits, this.geoType, options));
                });
            });
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
              this.geoField = selected;
              this.geoType = getGeoType(this.geoField).type;
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
                  >
                    Cancel
                  </EuiButton>
                </EuiFlexItem>

                <EuiFlexItem grow={false}>
                  <EuiButton
                    fill
                    size='s'
                    onClick={() => {
                      onConFirm();
                      onClose();
                    }}
                  >
                    Confirm
                  </EuiButton>
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
        if (this.geoField) {
          this.geoType = savedSearch.searchSource._state.index.fields.byName[self.geoField].type;
          processLayer();
        } else if (!this.geoType) {
          geoFieldSelectModal();
        }

      });
    };

    POIs.prototype._createLayer = function (hits, geoType, options) {
      let layer = null;
      const self = this;

      function makePoints(features) {
      //  let points = {};

        const markerList = [];
        features.forEach(function (feature) {
          const markerCount = _.get(feature, 'properties.value', 1);
          let centerLat;
          let centerLon;

          if (_.has(feature, 'properties.geohash')) {
            //aggs
            centerLat = feature.geometry.coordinates[1];
            centerLon = feature.geometry.coordinates[0];

            // const myIcon = L.divIcon({
            //   html: '<div class="clustergroup0 leaflet-marker-icon marker-cluster marker-cluster-medium' +
            //     'leaflet-zoom-animated leaflet-clickable" tabindex="0" style="margin-left: -20px; margin-top: -20px; width: 40px;' +
            //     'height: 40px; z-index: 233;"><div><span>' + markerCount + '</span></div></div>'
            // });
            const marker = L.marker([centerLat, centerLon], {
              icon: markerClusteringIcon(markerCount)
            });

            self._createMarker(feature, options);
            //marker.numberOfDocuments = markerCount;
            //marker.sentiment = agg.sentiment_avg.value;
            //marker.bindPopup('' + marker.numberOfDocuments); // this is where tooltip popups are added
            markerList.push(marker);
          } else {
            //docs
            const centerLatAndLong = feature._source.location; //.split(',');
            centerLat = Number(centerLatAndLong[0]);
            centerLon = Number(centerLatAndLong[1]);
            const marker = self._createMarker(feature, options);
            // marker.numberOfDocuments = markerCount;
            //marker.sentiment = agg.sentiment_avg.value;
            //marker.bindPopup('' + markerCount); // this is where tooltip popups are added
            markerList.push(marker);
          }
        });
        return markerList;
      }

      if ('geo_point' === geoType) {
        // const markers = _.map(hits, hit => {
        //   return self._createMarker(hit, options);
        // });

        // layer = L.markerClusterGroup({
        //   chunkedLoading: true,
        //   showCoverageOnHover: true
        // });

        if (options.aggFeatures || hits) {


          // layer = L.markerClusterGroup({
          //   maxClusterRadius: 80,
          //   animateAddingMarkers: false,
          //   chunkedLoading: true,
          //   spiderfyOnMaxZoom: true,
          //   showCoverageOnHover: false,
          //   iconCreateFunction: function (cluster) {
          //     //Grouping the cluster returned by the server, if
          //     const markers = cluster.getAllChildMarkers();
          //     let numberOfDocuments = 0;
          //     markers.forEach(function (m) {
          //       console.log(m.numberOfDocuments);
          //       numberOfDocuments += m.numberOfDocuments;
          //     });
          //     return markerClusteringIcon(20, 100);
          //   }
          // });

          const featuresForLayer = makePoints(hits).concat(makePoints(options.aggFeatures));
          layer = new L.FeatureGroup(featuresForLayer);

          layer.destroy = () => layer.clearLayers(); //TODO add destroy method// layer.forEach(self._removeMouseEventsGeoPoint);
        }
      } else if ('geo_shape' === geoType) {
        const shapes = _.map(hits, hit => {
          const geometry = _.get(hit, `_source[${self.geoField}]`);
          if (geometry) {
            geometry.type = capitalizeFirstLetter(geometry.type);
          }

          let popupContent = false;
          if (self.popupFields.length > 0) {
            popupContent = self._popupContent(hit);
          }
          return {
            type: 'Feature',
            properties: {
              label: popupContent
            },
            geometry: geometry
          };
        });
        layer = L.geoJson(
          shapes,
          {
            onEachFeature: function onEachFeature(feature, polygon) {
              if (feature.properties.label) {
                polygon.bindPopup(feature.properties.label);
                polygon.on('mouseover', self.addMouseOverGeoShape);
                polygon.on('mouseout', self.addMouseOutToGeoShape);
              }

              if (_.get(feature, 'geometry.type') === 'Polygon') {
                polygon._click = function fireEtmSelectFeature() {
                  polygon._map.fire('etm:select-feature', {
                    geojson: polygon.toGeoJSON()
                  });
                };
                polygon.on('click', polygon._click);
              }
            },
            pointToLayer: function pointToLayer(feature, latlng) {
              return L.circleMarker(
                latlng,
                {
                  radius: 6
                });
            },
            style: {
              color: options.color,
              weight: 1.5,
              opacity: 0.65
            }
          }
        );
        layer.destroy = () => {
          _.each(layer._layers, polygon => {
            polygon.off('mouseover', self.addMouseOverGeoShape);
            polygon.off('mouseout', self.addMouseOutToGeoShape);
            if (polygon._click) {
              polygon.off('click', polygon._click);
              polygon._click = null;
            }
          });
        };
      } else {
        console.warn('Unexpected feature geo type: ' + geoType);
      }
      layer.id = options.id;
      layer.tooManyDocs = options.tooManyDocs;
      layer.filterPopupContent = options.filterPopupContent;
      layer.close = options.close;
      layer.displayName = options.displayName;
      layer.$legend = options.$legend;
      layer.layerGroup = options.layerGroup;
      return layer;
    };

    //Mouse event creation for GeoShape
    POIs.prototype.addMouseOverGeoShape = function (e) {
      if (!e.target._map.disablePopups) {
        this.openPopup();
      }
    };

    POIs.prototype.addMouseOutToGeoShape = function (e) {
      const self = this;

      self._popupMouseOut = function (e) {
        // detach the event, if one exists
        if (self._map) {
          // get the element that the mouse hovered onto
          const target = e.toElement || e.relatedTarget;
          // check to see if the element is a popup
          if (getParentWithClass(target, 'leaflet-popup')) {
            return true;
          }
          L.DomEvent.off(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
          self.closePopup();
        }
      };

      const target = e.originalEvent.toElement || e.originalEvent.relatedTarget;

      // check to see if the element is a popup
      if (getParentWithClass(target, 'leaflet-popup')) {
        L.DomEvent.on(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
        return true;
      }
      self.closePopup();
    };
    POIs.prototype.addClickToGeoShape = function (polygon) {
      polygon.on('click', polygon._click);
    };

    //Mouse event creation and closing for GeoPoints
    POIs.prototype._getMouseOverGeoPoint = function (content) {
      const popup = function (e) {
        if (!e.target._map.disablePopups) {
          const popupDimensions = {
            height: this._map.getSize().y * 0.9,
            width: Math.min(this._map.getSize().x * 0.9, 400)
          };
          L.popup({
            autoPan: false,
            maxHeight: popupDimensions.height,
            maxWidth: popupDimensions.width,
            offset: utils.popupOffset(this._map, content, e.latlng, popupDimensions)
          })
            .setLatLng(e.latlng)
            .setContent(content)
            .openOn(this._map);
        }
      };
      return popup;
    };

    POIs.prototype._addMouseOutGeoPoint = function (e) {
      const self = this;

      self._popupMouseOut = function (e) {
        // detach the event, if one exists
        if (self._map) {
          // get the element that the mouse hovered onto
          const target = e.toElement || e.relatedTarget;
          // check to see if the element is a popup
          if (getParentWithClass(target, 'leaflet-popup')) {
            return true;
          }
          L.DomEvent.off(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
          self._map.closePopup();
        }
      };

      const target = e.originalEvent.toElement || e.originalEvent.relatedTarget;

      // check to see if the element is a popup
      if (getParentWithClass(target, 'leaflet-popup')) {
        L.DomEvent.on(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
        return true;
      }
      self._map.closePopup();
    };

    POIs.prototype._addMouseEventsGeoPoint = function (feature, content) {
      feature.on('mouseover', this._getMouseOverGeoPoint(content));
      feature.on('mouseout', this._addMouseOutGeoPoint);
    };

    POIs.prototype._removeMouseEventsGeoPoint = function (feature) {
      feature.off('mouseover');
      feature.off('mouseout');
    };

    POIs.prototype._createMarker = function (hit, options) {
      const feature = L.marker(
        toLatLng(_.get(hit, `_source[${this.geoField}]`)),
        {
          icon: searchIcon(options.searchIcon, options.color, options.size)
        });

      if (this.popupFields.length > 0) {
        const content = this._popupContent(hit);
        this._addMouseEventsGeoPoint(feature, content);
      }
      return feature;
    };

    POIs.prototype._popupContent = function (hit) {
      let dlContent = '';
      if (_.has(hit, '_source')) {
        this.popupFields.forEach(function (field) {
          dlContent += `<dt>${field}</dt><dd>${hit._source[field]}</dd>`;
        });
      }
      return `<dl>${dlContent}</dl>`;
    };

    function capitalizeFirstLetter(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    }

    return POIs;
  };
});
