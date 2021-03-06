/* eslint-disable siren/memory-leak */

import _ from 'lodash';
import uuid from 'uuid';
import chrome from 'ui/chrome';
import { Binder } from 'ui/binder';
import MapProvider from 'plugins/enhanced_tilemap/vislib/_map';
import { VislibVisTypeBuildChartDataProvider } from 'ui/vislib_vis_type/build_chart_data';
import { backwardsCompatible } from './backwardsCompatible';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import { ResizeCheckerProvider } from 'ui/vislib/lib/resize_checker';
import { uiModules } from 'ui/modules';
import { TileMapTooltipFormatterProvider } from 'ui/agg_response/geo_json/_tooltip_formatter';
import Vector from './vislib/vector_layer_types/vector';
import { compareStates } from 'ui/kibi/state_management/compare_states';
import SpinControl from './vislib/spin_control';
import SirenSessionState from './vislib/session_state';
import { getMarkerClusteringPrecision } from './vislib/marker_cluster_helper';

define(function (require) {
  const module = uiModules.get('kibana/enhanced_tilemap', [
    'kibana',
    'etm-ui.bootstrap.accordion',
    'rzModule',
    'angularjs-dropdown-multiselect'
  ]);

  module.controller('KbnEnhancedTilemapVisController', function (
    kibiState, savedSearches, savedDashboards, dashboardGroups, savedVisualizations,
    $scope, $rootScope, $element, $timeout, joinExplanation,
    Private, courier, config, getAppState, indexPatterns, $http, $injector,
    timefilter, createNotifier, es, sirenSession, $route, serviceSettings) {
    const buildChartData = Private(VislibVisTypeBuildChartDataProvider);
    const queryFilter = Private(FilterBarQueryFilterProvider);
    const callbacks = Private(require('plugins/enhanced_tilemap/callbacks'));
    const geoFilter = Private(require('plugins/enhanced_tilemap/vislib/geoFilter'));
    const POIsProvider = Private(require('plugins/enhanced_tilemap/vislib/vector_layer_types/POIs'));
    const utils = require('plugins/enhanced_tilemap/utils');
    const RespProcessor = require('plugins/enhanced_tilemap/resp_processor');
    const aggPrecisions = require('ui/kibi/agg_types/buckets/agg_precision_types');
    const maxPrecision = parseInt(config.get('visualization:tileMap:maxPrecision'), 10) || 12;
    const TileMapMap = Private(MapProvider);
    const ResizeChecker = Private(ResizeCheckerProvider);
    const VisTooltip = Private(require('plugins/enhanced_tilemap/tooltip/visTooltip'));
    const BoundsHelper = Private(require('plugins/enhanced_tilemap/vislib/DataBoundsHelper'));
    let collar = null;
    let chartData = null;
    let _currentTimeFilter;
    let map = null;
    let tooltip = null;
    let tooltipFormatter = null;
    let storedTime = _.cloneDeep(timefilter.time);
    let spinControl;
    let sirenSessionState;

    const uiState = $scope.vis.getUiState(); // note - true, false, se (saved and enabled on map), sne (saved but not enabled on map) and undefined (new to uistate) are all possible states

    const appState = getAppState();
    let storedState = {
      filters: _.cloneDeep(appState.filters),
      query: _.cloneDeep(appState.query)
    };
    $scope.flags = {};

    let dragEnded = true;
    const _currentMapEnvironment = {};

    const notify = createNotifier({
      location: 'Enhanced Coordinate Map'
    });

    async function initialize() {
      backwardsCompatible.updateParams($scope.vis.params);
      // Note - true, false, se (saved and enabled on map), sne (saved but not enabled on map) and undefined (new to uistate) are all possible states
      sirenSessionState = new SirenSessionState();
      sirenSessionState.register(uiState, sirenSession, $route.current.params.id, $scope.vis.id);
      createDragAndDropPoiLayers();
      appendMap();
      map.createBaseLayer(getTileMapFromInvestigateYaml, map._attr.wms.url, map._attr.wms.options, _.get(map, '_attr.wms.enabled', null));
      modifyToDsl();
      await setTooltipFormatter($scope.vis.params.tooltip, $scope.vis._siren);
      drawWfsOverlays();
      _updateCurrentTimeFilter();
      $scope.searchSource.vis.currentTimeFilter = _.cloneDeep(timefilter.get($scope.vis.indexPattern));
      await drawLayers();

      if (_shouldAutoFitMapBoundsToData(true)) {
        _doFitMapBoundsToData();
      }
    }

    initialize();

    const shapeFields = $scope.vis.indexPattern.fields.filter(function (field) {
      return field.type === 'geo_shape';
    }).map(function (field) {
      return field.name;
    });
    //Using $root as mechanism to pass data to vis-editor-vis-options scope
    $scope.$root.etm = {
      shapeFields: shapeFields
    };

    const binder = new Binder();
    const resizeChecker = new ResizeChecker($element);
    binder.on(resizeChecker, 'resize', function () {
      resizeArea();
    });

    // kibi: moved processor to separate file
    const respProcessor = new RespProcessor($scope.vis, buildChartData, utils);
    // kibi: end

    /*
     * Field used for Geospatial filtering can be set in multiple places
     * 1) field specified by geohash_grid aggregation
     * 2) field specified under options. Allows for filtering by geo_shape
     *
     * Use this method to locate the field
     */
    function getGeoField() {
      let fieldname = null;
      let geotype = 'geo_point';
      if ($scope.vis.params.filterByShape && $scope.vis.params.shapeField) {
        fieldname = $scope.vis.params.shapeField;
        geotype = 'geo_shape';
      } else {
        const agg = utils.getAggConfig($scope.vis.aggs, 'segment');
        if (agg) {
          fieldname = agg.fieldName();
        }
      }
      return {
        fieldname: fieldname,
        geotype: geotype
      };
    }

    function isHeatMap() {
      return map._markerType === 'Heatmap' && !!_.get(map._markers, 'unfixTooltips');
    }
    function getIndexPatternId() { return $scope.vis.indexPattern.id; }
    function getSirenMeta() { return $scope.vis._siren; }
    function getStoredLayerConfig() {
      function spatialPathCountCheck(storedLayerConfig) {
        return _.filter(storedLayerConfig, config => !config.spatial_path).length > 1;
      }
      try {
        if (_.isEmpty($scope.vis.params.storedLayerConfig)) {
          notify.warning(`Detected an empty Stored Layer Config with Stored Layers present`);
        } else {
          const storedLayerConfig = _.orderBy(JSON.parse($scope.vis.params.storedLayerConfig), ['spatial_path'], ['asc']);
          if (spatialPathCountCheck(storedLayerConfig)) {
            notify.error(`Stored Layer Config permits one default config object (without a spatial_path attribute)`);
          } else {
            return storedLayerConfig;
          }
        }
      } catch (error) {
        notify.error(`An issue with your Stored Layer Configuration has been detected: ${error}`);
      }
    }

    async function searchHasGeofield(savedSearchId) {
      const savedSearch = await savedSearches.get(savedSearchId);
      const field = _.get(savedSearch, 'searchSource._state.index.fields', [])
        .find(field => (field.esType === 'geo_point' || field.esType === 'geo_shape'));

      return !!field;
    }

    function getPoiLayerParamsById(id, isDragAndDrop) {
      if (isDragAndDrop) {
        return _.find($scope.vis.params.overlays.dragAndDropPoiLayers, { id });
      } else {
        return _.find($scope.vis.params.overlays.savedSearches, { id });
      }
    }

    async function addPOILayerFromDashboardWithModal(dashboardId) {
      const group = dashboardGroups.getGroup(dashboardId);
      if (group) {
        const dash = _.find(group.dashboards, { id: dashboardId });

        if (dash && dash.count && dash.count > 0) {
          const dashCounts = {};
          dashCounts[dashboardId] = dash.count;

          const savedDashboard = await getDashboard(dashboardId);
          const savedSearchId = savedDashboard.getMainSavedSearchId();
          const hasGeofield = await searchHasGeofield(savedSearchId);

          if (!(savedSearchId && hasGeofield)) {
            return;
          }

          const dragAndDropPoiLayer = {
            savedSearchId
          };
          const state = await kibiState.getState(dashboardId);
          const index = await indexPatterns.get(state.index);

          dragAndDropPoiLayer.draggedState = {
            filters: state.filters,
            query: state.queries,
            index,
            savedSearchId: savedSearchId
          };
          dragAndDropPoiLayer.savedDashboardTitle = savedDashboard.lastSavedTitle;
          dragAndDropPoiLayer.isInitialDragAndDrop = true;
          if (!dragAndDropPoiLayer.id)  {
            dragAndDropPoiLayer.id = uuid.v1();
            sirenSessionState.set(dragAndDropPoiLayer.id, true);
          }
          dragAndDropPoiLayer.limit = 250;
          dragAndDropPoiLayer.isDragAndDrop = true;
          // initialize on drop
          initPOILayer(dragAndDropPoiLayer);

          //create drag and drop Poi layers array if one doesn't exist
          createDragAndDropPoiLayers();
          $scope.vis.params.overlays.dragAndDropPoiLayers.push(dragAndDropPoiLayer);

        }
      }
    }

    function createDragAndDropPoiLayers() {
      if (!$scope.vis.params.overlays.dragAndDropPoiLayers) {
        $scope.vis.params.overlays.dragAndDropPoiLayers = [];
      }
    }

    function modifyToDsl() {
      $scope.vis.aggs.origToDsl = $scope.vis.aggs.toDsl;
      $scope.vis.aggs.toDsl = function () {
        resizeArea();
        const dsl = $scope.vis.aggs.origToDsl();

        //append map collar filter to geohash_grid aggregation
        _.keys(dsl).forEach(function (key) {
          if (_.has(dsl[key], 'geohash_grid')) {
            const origAgg = dsl[key];
            dsl[key] = {
              filter: aggFilter(origAgg.geohash_grid.field),
              aggs: {
                filtered_geohash: origAgg
              }
            };
          }
        });
        return dsl;
      };
    }

    /**
     * @method _shouldAutoFitMapBoundsToData
     * @param forceAutoFitToBounds {boolean, flag to force auto fit to bounds regardless of app time / state}
     */
    //checking appstate and time filters to identify
    //if map change was related to map event or
    //a separate change on a dashboard OR from vis params
    function _shouldAutoFitMapBoundsToData(forceAutoFitToBounds = false) {
      if (!$scope.vis.params.autoFitBoundsToData) {
        return false;
      }
      const newTime = timefilter.time;
      const appState = getAppState();
      const newState = {
        filters: appState.filters,
        query: appState.query
      };

      const differentTimeOrState = !compareStates(newState, storedState).stateEqual ||
        !kibiState.compareTimes(newTime, storedTime);

      if (forceAutoFitToBounds || differentTimeOrState) {
        storedTime = _.cloneDeep(newTime);
        storedState = _.cloneDeep(newState);
        return true;
      }
    }

    function _doFitMapBoundsToData() {
      const boundsHelper = new BoundsHelper($scope.searchSource, getGeoField().fieldname);
      boundsHelper.getBoundsOfEntireDataSelection($scope.vis)
        .then(entireBounds => {
          if (entireBounds) {
            map.leafletMap.fitBounds(entireBounds);
            //update uiState zoom so correct geohash precision will be used
            uiState.set('mapZoom', map.leafletMap.getZoom());
            sirenSessionState.set('mapZoom', map.leafletMap.getZoom());
          }
        });
    }

    function aggFilter(field) {
      collar = utils.geoBoundingBoxBounds(
        map.mapBounds(),
        $scope.vis.params.collarScale);
      const filter = { geo_bounding_box: {} };
      filter.geo_bounding_box[field] = collar;
      return filter;
    }

    function _updateCurrentTimeFilter() {
      _currentTimeFilter = timefilter.get($scope.vis.indexPattern);
    }

    function setCurrentTimeFilter(searchSource) {
      if (!searchSource.vis) {
        searchSource.vis = $scope.vis;
      }
      searchSource.vis.currentTimeFilter = _currentTimeFilter;
    }

    function getMapBounds() {
      return utils.geoBoundingBoxBounds(map.mapBounds(), 1);
    }

    function getMapBoundsWithCollar() {
      return utils.geoBoundingBoxBounds(map.mapBounds(), $scope.vis.params.collarScale);
    }

    function getGeoBoundingBox() {
      const geoBoundingBox = utils.geoBoundingBoxBounds(map.mapBounds(), $scope.vis.params.collarScale);
      return { geo_bounding_box: geoBoundingBox };
    }

    function getGeoShapeBox() {
      const geoShapeBox = utils.geoShapeScaleBounds(map.mapBounds(), $scope.vis.params.collarScale);
      return { geo_shape: geoShapeBox };
    }

    function saturateWMSTile(layer) {
      map.saturateTile($scope.vis.params.isDesaturated, layer);
    }

    async function getDashboard(dashboardId) {
      return await savedDashboards.get(dashboardId);
    }

    function _getDefaultVectorLayerOptions(layerParams, displayName, id) {
      return {
        color: _.get(layerParams, 'color', '#008800'),
        displayName,
        id,
        leafletMap: map.leafletMap,
        mainVisGeoFieldName: getGeoField().fieldname,
        mapExtentFilter: {
          geo_bounding_box: getGeoBoundingBox(),
          geoField: getGeoField()
        },
        searchSource: $scope.searchSource,
        _siren: getSirenMeta(),
        size: _.get(layerParams, 'markerSize', 'm'),
        vis: $scope.vis,
      };
    }

    function _drawPoiLayers(poiLayerArray, queryFilterChange) {
      if (!poiLayerArray) return;

      poiLayerArray.forEach(layerParams => {
        layerParams.enabled = sirenSessionState.get(layerParams.id);

        //new layers are always visible on first load, uistate takes precedence from then on
        if (layerParams.enabled === undefined) {
          uiState.set(layerParams.id, true);
          sirenSessionState.set(layerParams.id, true);
          layerParams.enabled = true;
        }

        const layer = map._layerControl.getLayerById(layerParams.id);
        let warning;
        if (layer) {
          warning = layer.warning;
          if (layer.unspiderfy) {
            layer.unspiderfy();
          }
        }

        if ((queryFilterChange && layerParams.enabled) ||
          utils.drawLayerCheck(layerParams,
            _currentMapEnvironment.currentMapBounds,
            _currentMapEnvironment.currentZoom,
            _currentMapEnvironment.currentClusteringPrecision,
            warning,
            _currentTimeFilter)) {
          initPOILayer(layerParams);
        }
      });
    }

    function initPOILayer(layerParams) {
      spinControl.create();
      const poi = new POIsProvider(layerParams);
      const displayName = layerParams.displayName || layerParams.savedSearchLabel;
      layerParams.mapParams = {
        zoomLevel: _currentMapEnvironment.currentZoom,
        precision: getMarkerClusteringPrecision(_currentMapEnvironment.currentZoom),
        mapBounds: getMapBoundsWithCollar()
      };
      layerParams.currentTimeFilter = _currentTimeFilter;

      const options = {
        ..._getDefaultVectorLayerOptions(layerParams, displayName, layerParams.id),
        ...{
          dsl: $scope.vis.aggs.toDsl(),
          geoFieldName: layerParams.geoField,
          setCurrentTimeFilter,
          zoom: map.leafletMap.getZoom(),
          isDragAndDrop: layerParams.isDragAndDrop
        }
      };

      poi.getLayer(options, function (layer) {
        map.addFeatureLayer(layer);
      });
    }

    function initVectorLayer(id, displayName, geoJsonCollection, layerParams) {
      spinControl.create();
      let popupFields = [];
      if (_.get(layerParams, 'popupFields') === '' || !_.get(layerParams, 'popupFields')) {
        popupFields = [];
      } else if (_.get(layerParams, 'popupFields').indexOf(',') > -1) {
        popupFields = _.get(layerParams, 'popupFields').split(',');
      } else {
        popupFields = [_.get(layerParams, 'popupFields', [])];
      }

      const options = {
        ..._getDefaultVectorLayerOptions(layerParams, displayName, id),
        ...{
          indexPattern: getIndexPatternId(),
          type: _.get(layerParams, 'type', 'noType'),
          popupFields
        }
      };

      const layer = new Vector(geoJsonCollection).getLayer(options);
      layer.id = id;
      map.addFeatureLayer(layer, options);
    }

    /*
    * draws all layer types, called from moveend listener and vis.params watcher
    *
    */
    async function drawLayers(fromVisParams) {
      // todo drawWfsOverlays could be here if bounds filters were built into the request
      await drawAggregationLayer(fromVisParams);
      _drawWmsOverlays();
      _drawGeoFilters();
      _drawPoiLayers($scope.vis.params.overlays.savedSearches);
      _drawPoiLayers($scope.vis.params.overlays.dragAndDropPoiLayers);
    }

    $scope.$watch('vis.params', async function (visParams, oldParams) {
      if (visParams !== oldParams) {
        //When vis is first opened, vis.params gets updated with old context
        backwardsCompatible.updateParams($scope.vis.params);
        _updateCurrentMapEnvironment();
        if (_shouldAutoFitMapBoundsToData(true)) _doFitMapBoundsToData();
        $scope.flags.isVisibleSource = 'visParams';

        // The stored layer config may have changed, so it is updated
        map._layerControl.setStoredLayerConfigs(getStoredLayerConfig());
        // The stored layers in the UIState are also loaded when vis.params are applied
        map._layerControl.loadSavedStoredLayers();

        map.removeAllLayersFromMapandControl();
        // base layer
        map.createBaseLayer(null, visParams.wms.url, visParams.wms.options, visParams.wms.enabled);
        await setTooltipFormatter(visParams.tooltip, $scope.vis._siren);

        if (isHeatMap()) {
          map.unfixMapTypeTooltips();
        }
        await drawLayers(true);
        //re-draw vector overlays
        drawWfsOverlays();
      }
    });

    $scope.$watch('esResponse', function (resp) {
      if (_.has(resp, 'aggregations')) {
        chartData = respProcessor.process(resp);
        chartData.searchSource = $scope.searchSource;
        if (_shouldAutoFitMapBoundsToData()) {
          _doFitMapBoundsToData();
        }
        putAggregationLayerOnMap();
      }
    });

    $scope.$watch('vis.aggs', function () {
      // 'apply changes' creates new vis.aggs object - ensure toDsl is overwritten again
      if (!_.has($scope.vis.aggs, 'origToDsl')) {
        modifyToDsl();
      }
    });

    //updating from query, time and auto-update
    $scope.$listen(timefilter, 'update', () => drawLayersFromQueryOrTimeFilterUpdate());
    $scope.$listen(queryFilter, 'update', () => drawLayersFromQueryOrTimeFilterUpdate());
    $rootScope.$on('courier:searchRefresh', () => drawLayersFromQueryOrTimeFilterUpdate());

    async function drawLayersFromQueryOrTimeFilterUpdate() {
      if (!map.leafletMap) return;
      await setTooltipFormatter($scope.vis.params.tooltip, $scope.vis._siren);
      _updateCurrentTimeFilter();
      setCurrentTimeFilter($scope.searchSource);
      //redraw these layers because they are specific to filters and time changes
      await drawAggregationLayer();
      _drawPoiLayers($scope.vis.params.overlays.savedSearches, true);
      _drawPoiLayers($scope.vis.params.overlays.dragAndDropPoiLayers, true);
      _drawGeoFilters();
    }

    $scope.$on('$destroy', function () {
      binder.destroy();
      resizeChecker.destroy();
      _destroyKibiStateEvents();
      if (map) map.destroy();
      if (tooltip) tooltip.destroy();
    });

    function _destroyKibiStateEvents() {
      kibiState.off('drop_on_graph');
      kibiState.off('drag_on_graph');
    }

    function _drawGeoFilters() {
      const fieldName = getGeoField().fieldname;
      if (fieldName) {
        map.addFilters(geoFilter.getGeoFilters(fieldName));
      }
    }

    async function setTooltipFormatter(tooltipParams, sirenMeta) {
      if (tooltip) {
        tooltip.destroy();
      }

      const options = {
        xRatio: _.get(tooltipParams, 'options.xRatio', 0.6),
        yRatio: _.get(tooltipParams, 'options.yRatio', 0.6)
      };
      const geoField = getGeoField();
      if (_.get(tooltipParams, 'type') === 'visualization') {
        const visId = _.get(tooltipParams, 'options.visId');
        const savedVis = await savedVisualizations.get(visId);
        tooltip = new VisTooltip(
          savedVis,
          geoField.fieldname,
          geoField.geotype,
          sirenMeta,
          options
        );
        tooltipFormatter = tooltip.getFormatter();
      } else {
        tooltipFormatter = Private(TileMapTooltipFormatterProvider);
      }

    }

    function drawWfsOverlays() {

      if ($scope.vis.params.overlays.wfsOverlays &&
        $scope.vis.params.overlays.wfsOverlays.length === 0) {
        return;
      }
      spinControl.create();
      _.each($scope.vis.params.overlays.wfsOverlays, wfsOverlay => {
        const options = {
          color: _.get(wfsOverlay, 'color', '#10aded'),
          popupFields: _.get(wfsOverlay, 'popupFields', '')
        };

        const url = wfsOverlay.url.substr(wfsOverlay.url.length - 5).toLowerCase() !== '/wfs?' ? wfsOverlay.url + '/wfs?' : wfsOverlay.url;
        const wfsSpecific = 'service=wfs&version=1.1.0&request=GetFeature&';
        const type = `typeNames=${wfsOverlay.layers}&outputFormat=${wfsOverlay.formatOptions}`;
        const getFeatureRequest = `${url}${wfsSpecific}${type}`;

        return $http.get(getFeatureRequest)
          .then(resp => {
            initVectorLayer(wfsOverlay.id, wfsOverlay.displayName, resp.data, options);
          })
          .catch(() => {
            notify.error(`An issue was encountered returning ${wfsOverlay.layers} from WFS request. Please ensure:
              - url ( ${wfsOverlay.url} ) is correct and has layers present,
              - ${wfsOverlay.formatOptions} is an allowed output format
              - WFS is CORs enabled for this domain`);
            map.removeLayerFromMapAndControlById(wfsOverlay.id);
          });
      });
    }

    function _drawWmsOverlays() {
      if ($scope.vis.params.overlays.wmsOverlays.length === 0) {
        return;
      }

      spinControl.create();
      $scope.vis.params.overlays.wmsOverlays.map(function (layerParams) {

        let enabled = true;
        if ($scope.flags.isVisibleSource === 'visParams') {
          enabled = layerParams.isVisible;
        } else if (uiState.get(layerParams.id) === false) {
          enabled = false;
        }
        const options = {
          enabled,
          nonTiled: _.get(layerParams, 'nonTiled', false)
        };


        // const prevState = map.clearLayerAndReturnPrevState(layerParams.id);
        const wmsIndexId = _.get(layerParams, 'indexId', getIndexPatternId());
        return indexPatterns.get(wmsIndexId).then(function (indexPattern) {
          const source = new courier.SearchSource();
          const appState = getAppState();
          source.set('filter', queryFilter.getFilters());
          if (appState.query && !appState.linked) {
            source.set('query', appState.query);
          }
          source.index(indexPattern);
          return source._flatten().then(function (fetchParams) {
            const esQuery = fetchParams.body.query;
            //remove kibana parts of query
            const cleanedMust = [];
            if (_.has(esQuery, 'bool.must')) {
              esQuery.bool.must.forEach(function (must) {
                cleanedMust.push(_.omit(must, ['$state', '$$hashKey']));
              });
            }
            esQuery.bool.must = cleanedMust;
            const cleanedMustNot = [];
            if (_.has(esQuery, 'bool.must_not')) {
              esQuery.bool.must_not.forEach(function (mustNot) {
                cleanedMustNot.push(_.omit(mustNot, ['$state', '$$hashKey']));
              });
            }
            esQuery.bool.must_not = cleanedMustNot;

            if (JSON.stringify(esQuery).includes('join_sequence')) {
              return $http.post(chrome.getBasePath() + '/translateToES', { query: esQuery })
                .then(resp => {
                  return resp.data.translatedQuery;
                });
            } else {
              return Promise.resolve(esQuery);
            }
          })
            .then(esQuery => {
              const name = _.get(layerParams, 'displayName', layerParams.layers);
              const wmsOptions = {
                format: 'image/png',
                layers: layerParams.layers,
                maxFeatures: _.get(layerParams, 'maxFeatures', 1000),
                minZoom: _.get(layerParams, 'minZoom', 13),
                transparent: true,
                version: '1.1.1'
                // pane: 'overlayPane'
              };
              const viewparams = [];
              if (_.get(layerParams, 'viewparams')) {
                viewparams.push('q:' + JSON.stringify(esQuery));
              }
              const aggs = _.get(layerParams, 'agg', '');
              if (aggs.length !== 0) {
                viewparams.push('a:' + aggs);
              }
              if (viewparams.length >= 1) {
                //http://docs.geoserver.org/stable/en/user/data/database/sqlview.html#using-a-parametric-sql-view
                wmsOptions.viewparams = _.map(viewparams, param => {
                  let escaped = param;
                  escaped = escaped.replace(new RegExp('[,]', 'g'), '\\,'); //escape comma
                  //escaped = escaped.replace(/\s/g, ''); //remove whitespace
                  return escaped;
                }).join(';');
              }
              const cqlFilter = _.get(layerParams, 'cqlFilter', '');
              if (cqlFilter.length !== 0) {
                wmsOptions.CQL_FILTER = cqlFilter;
              }
              const styles = _.get(layerParams, 'styles', '');
              if (styles.length !== 0) {
                wmsOptions.styles = styles;
              }
              const formatOptions = _.get(layerParams, 'formatOptions', '');
              if (formatOptions.length !== 0) {
                wmsOptions.format_options = formatOptions;
              }

              layerParams.type = 'wms';
              if (utils.isXyzUrl(layerParams.url)) {
                layerParams.url = layerParams.url;
                layerParams.type = 'xyz';
              } else if (layerParams.url.substr(layerParams.url.length - 5).toLowerCase() !== '/wms?') {
                layerParams.url = layerParams.url + '/wms?';
              }
              return map.addWmsOverlay(layerParams.url, name, wmsOptions, options, layerParams.id, layerParams.type, notify);
            });
        });
      });
      $scope.flags.isVisibleSource = '';
    }

    function _updateCurrentMapEnvironment() {
      _currentMapEnvironment.currentMapBounds = getMapBounds();
      _currentMapEnvironment.currentMapBoundsWithCollar = getMapBoundsWithCollar();
      _currentMapEnvironment.currentZoom = map.leafletMap.getZoom();
      _currentMapEnvironment.mapCenter = map.leafletMap.getCenter();
      _currentMapEnvironment.currentClusteringPrecision = getMarkerClusteringPrecision(_currentMapEnvironment.currentZoom);

      if ($scope.vis.aggs[1]) {
        const precisionType = $scope.vis.aggs[1].params.aggPrecisionType.toLowerCase();
        if (precisionType === 'default') {
          _currentMapEnvironment.currentAggregationPrecision =
            aggPrecisions.getDefaultZoomPrecision(maxPrecision)[_currentMapEnvironment.currentZoom];
        } else {
          _currentMapEnvironment.currentAggregationPrecision = aggPrecisions[precisionType][_currentMapEnvironment.currentZoom];
        }
      }
    }

    async function getTileMapFromInvestigateYaml() {
      const tmsService = await serviceSettings.getTMSService();
      return tmsService.getTMSOptions();
    }

    function appendMap() {
      const params = $scope.vis.params;
      const container = $element[0].querySelector('.tilemap');
      container.id = `etm-vis-${$scope.vis.panelIndex}`;
      const mainSearchDetails = {
        getIndexPatternId,
        getGeoField,
        getSirenMeta,
        geoShapeMapExtentFilter: getGeoShapeBox,
        geoPointMapExtentFilter: getGeoBoundingBox,
        getMapBounds,
        getMapBoundsWithCollar,
        respProcessor: new RespProcessor($scope.vis, buildChartData, utils),
        geoFilter,
        storedLayerConfig: getStoredLayerConfig(),
        uiState,
        sirenSessionState,
        saturateWMSTile,
      };

      map = new TileMapMap(container, {
        mainSearchDetails,
        $element,
        es,
        callbacks: callbacks,
        mapType: params.mapType,
        attr: params,
        editable: $scope.vis.getEditableVis() ? true : false,
        uiState,
        sirenSessionState,
        syncMap: params.syncMap
      });
      mainSearchDetails.spinControl = spinControl = new SpinControl(map.leafletMap);
    }

    function resizeArea() {
      if (map) map.updateSize();
    }

    function putAggregationLayerOnMap() {
      if (_shouldAutoFitMapBoundsToData()) {
        _doFitMapBoundsToData();
      }

      map.addMarkers(
        chartData,
        $scope.vis.params,
        tooltipFormatter,
        _.get(chartData, 'valueFormatter', _.identity),
        collar);
    }

    async function drawAggregationLayer(fromVisParams) {
      let drawAggs;
      // checking that the agg has been configured,
      //e.g. a main spatial field has been set on new vis
      if (_.get($scope.vis, 'aggs[1]')) {
        if (map._chartData && // if parameters haven't been assigned yet, fire the query
          (map.aggLayerParams && map.aggLayerParams.mapParams && map.aggLayerParams.mapParams.zoomLevel)) {
          const autoPrecision = _.get(map, '_chartData.geohashGridAgg.params.autoPrecision') || map.aggLayerParams.autoPrecision; //use previous as default
          const layerOnMap = map._layerControl.getLayerById('Aggregation');
          if (!layerOnMap ||
            autoPrecision && utils.drawLayerCheck(map.aggLayerParams,
              _currentMapEnvironment.currentMapBounds,
              _currentMapEnvironment.currentZoom,
              _currentMapEnvironment.currentAggregationPrecision,
              false,
              _currentTimeFilter)) {
            drawAggs = true;
          } else if (!autoPrecision && (!utils.contains(map.aggLayerParams.mapParams.mapBounds, _currentMapEnvironment.currentMapBounds))) {
            drawAggs = true;
          }
        } else {
          drawAggs = true;
        }

        if (drawAggs || fromVisParams) {
          spinControl.create();
          $scope.flags.drawingAggs = true;
          map.aggLayerParams = {};
          map.aggLayerParams.enabled = sirenSessionState.get('Aggregation');
          // always enabled first time drawn
          if (map.aggLayerParams.enabled === undefined) {
            map.aggLayerParams.enabled = true;
            uiState.set('Aggregation', true);
            sirenSessionState.set('Aggregation', true);
          }
          map.aggLayerParams.type = 'agg';

          // need to assign auto precision as not accessible from vis scope and is null if no data present for map extent
          const autoPrecision = _.get(map, '_chartData.geohashGridAgg.params.autoPrecision');
          if (autoPrecision) {
            map.aggLayerParams.autoPrecision = autoPrecision;
          }

          map.aggLayerParams.mapParams = {
            mapBounds: _currentMapEnvironment.currentMapBoundsWithCollar,
            zoomLevel: _currentMapEnvironment.currentZoom,
            precision: _currentMapEnvironment.currentAggregationPrecision
          };

          map.aggLayerParams.currentTimeFilter = _currentTimeFilter;

          await $scope.searchSource.fetch();
        }
      }
    }
    // ============================
    // === API actions ===
    // ============================

    if ($injector.has('actionRegistry')) {
      const actionRegistry = $injector.get('actionRegistry');
      const apiVersion = '1';

      actionRegistry.register(apiVersion, $scope.vis.id, 'renderGeoJsonCollection', async (id, layerName, geoJsonCollection, options) => {
        return initVectorLayer(id, layerName, geoJsonCollection, options);
      });

      actionRegistry.register(apiVersion, $scope.vis.id, 'removeGeoJsonCollection', async (id) => {
        return map.removeLayerFromMapAndControlById(id);
      });

      actionRegistry.register(apiVersion, $scope.vis.id, 'getGeoBoundingBox', async () => {
        return getGeoBoundingBox();
      });
    }

    // ============================
    // ==POI drag and drop events==
    // ============================

    kibiState.on('drop_on_graph', (dashboardId, droppedContainerId) => {
      if ($scope.vis.id === droppedContainerId) addPOILayerFromDashboardWithModal(dashboardId);
    });

    kibiState.on('drag_on_graph', async (showDropHover, dashHasSearch, dashboardId) => {
      dragEnded = !showDropHover;
      const savedDashboard = await savedDashboards.get(dashboardId);
      const savedSearchId = savedDashboard.getMainSavedSearchId();

      if (!dragEnded || !showDropHover) {
        $scope.showDropHover = showDropHover;
        $scope.showDropMessage = await searchHasGeofield(savedSearchId);
      }
    });

    // ===========================
    // ==  Map callback events  ==
    // ==  requiring access to  ==
    // ==       vis object      ==
    // ===========================

    map.leafletMap.on('removelayer', function (e) {
      if ($scope.vis.params.overlays.dragAndDropPoiLayers &&
        $scope.vis.params.overlays.dragAndDropPoiLayers.length >= 1) {
        $scope.vis.params.overlays.dragAndDropPoiLayers =
          _.filter($scope.vis.params.overlays.dragAndDropPoiLayers, function (dragAndDropPoiLayer) {
            return dragAndDropPoiLayer.id !== e.id;
          });
      }
      //scope for saving dnd poi overlays
      uiState.set(e.id, false);
      sirenSessionState.set(e.id, false);
    });

    // saving checkbox status to dashboard uiState
    map.leafletMap.on('showlayer', async function (e) {
      if (e.layerType === 'es_ref_shape' || e.layerType === 'es_ref_point') {
        let refLayerState = 'sne'; //saved but NOT enabled
        if (e.enabled) {
          refLayerState = 'se'; //saved and enabled
        }

        uiState.set(e.id, refLayerState);
        sirenSessionState.set(e.id, refLayerState);
      } else {
        uiState.set(e.id, e.enabled);
        sirenSessionState.set(e.id, e.enabled);
      }

      if (e.layerType === 'poi_shape' || e.layerType === 'poi_point') {
        const layerParams = getPoiLayerParamsById(e.id, e.isDragAndDrop);
        layerParams.enabled = e.enabled;
        layerParams.type = e.layerType;
        const layerOnMap = map._layerControl.getLayerById(layerParams.id);
        const warning = _.get(layerOnMap, 'warning');
        if (!layerOnMap ||
          utils.drawLayerCheck(layerParams,
            _currentMapEnvironment.currentMapBounds,
            _currentMapEnvironment.currentZoom,
            _currentMapEnvironment.currentClusteringPrecision,
            warning,
            _currentTimeFilter)) {
          initPOILayer(layerParams);
        }
      } else if (e.layerType === 'agg') {
        map.aggLayerParams.enabled = e.enabled;
        await drawAggregationLayer();
        map._markers.show();
      } else if (e.layerType === 'filter') {
        _drawGeoFilters();
      }
    });

    map.leafletMap.on('hidelayer', async function (e) {

      if (e.layerType === 'es_ref_shape' || e.layerType === 'es_ref_point') {
        uiState.set(e.id, 'sne'); //saved but NOT enabled
        sirenSessionState.set(e.id, 'sne'); //saved but NOT enabled
      } else {
        uiState.set(e.id, false);
        sirenSessionState.set(e.id, false);
      }

      if (e.layerType === 'poi_shape' || e.layerType === 'poi_point') {
        const layerParams = getPoiLayerParamsById(e.id, e.isDragAndDrop);
        layerParams.enabled = false;
      } else if (map._markers && e.layerType === 'agg') {
        if (isHeatMap()) {
          map.unfixMapTypeTooltips();
        }
        map._markers.hide();
        map.aggLayerParams.enabled = e.enabled;
      }
    });

    // saving checkbox status to dashboard uiState
    map.leafletMap.on('overlayadd', function (e) {
      if (map._markers && e.id === 'Aggregation') {
        map._markers.show();
      }
    });


    map.leafletMap.on('moveend', _.debounce(async function setZoomCenter() {
      if (!map.leafletMap) return;
      _updateCurrentMapEnvironment();
      // check if map zoom/center has change and update uiState if so
      if (map._hasSameLocation(_currentMapEnvironment.mapCenter, _currentMapEnvironment.currentZoom)) return;

      // update uiState center and zoom references
      uiState.set('mapCenter', [
        _.round(_currentMapEnvironment.mapCenter.lat, 5),
        _.round(_currentMapEnvironment.mapCenter.lng, 5)
      ]);
      uiState.set('mapZoom', _currentMapEnvironment.currentZoom);

      sirenSessionState.set('mapCenter', [
        _.round(_currentMapEnvironment.mapCenter.lat, 5),
        _.round(_currentMapEnvironment.mapCenter.lng, 5)
      ]);
      sirenSessionState.set('mapZoom', _currentMapEnvironment.currentZoom);

      await drawLayers();
    }, 500, false));

    map.leafletMap.on('setview:fitBounds', function () {
      _doFitMapBoundsToData();
    });

    map.leafletMap.on('draw:created', function (e) {
      const indexPatternId = getIndexPatternId();
      const field = getGeoField();
      const sirenMeta = getSirenMeta();

      switch (e.layerType) {
        case 'marker':
          map._drawnItems.addLayer(e.layer);
          map._callbacks.createMarker({
            latlng: e.layer._latlng
          });
          break;
        case 'polygon':
          const points = [];
          e.layer._latlngs[0].forEach(function (latlng) {
            const lat = L.Util.formatNum(latlng.lat, 5);
            const lon = L.Util.formatNum(latlng.lng, 5);
            points.push([lon, lat]);
          });
          map._callbacks.polygon({
            points,
            indexPatternId,
            field,
            sirenMeta
          });
          break;
        case 'rectangle':
          map._callbacks.rectangle({
            bounds: utils.geoBoundingBoxBounds(e.layer.getBounds(), 1),
            indexPatternId,
            field,
            sirenMeta
          });
          break;
        case 'circle':
          map._callbacks.circle({
            radius: e.layer._mRadius,
            center: [e.layer._latlng.lat, e.layer._latlng.lng],
            indexPatternId,
            field,
            sirenMeta
          });
          break;
        default:
          console.warn('draw:created, unexpected layerType: ' + e.layerType);
      }
    });

    map.leafletMap.on('etm:select-feature', function (e) {
      map._callbacks.polygon({
        points: e.geojson.geometry.coordinates[0],
        sirenMeta: getSirenMeta(),
      });
    });

    map.leafletMap.on('toolbench:poiFilter', function (e) {
      const poiLayers = [];
      const allLayers = map._layerControl.getAllLayers();
      allLayers.forEach(layer => {
        if (layer.type.endsWith('point') && !layer.hasClusters && map._layerControl.totalNumberOfPointsOnMap() <= 80) {
          poiLayers.push(layer);
        }
      });
      map._callbacks.poiFilter({
        chart: map._chartData,
        poiLayers,
        radius: _.get(e, 'radius', 10),
        indexPatternId: getIndexPatternId(),
        field: getGeoField(),
        sirenMeta: getSirenMeta()
      });
    });

  });
});
