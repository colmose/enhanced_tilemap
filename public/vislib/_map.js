import { markerIcon } from 'plugins/enhanced_tilemap/vislib/markerIcon';

define(function (require) {
  return function MapFactory(Private) {
    const formatcoords = require('formatcoords');
    const mgrs = require('mgrs/dist/mgrs.js');
    const _ = require('lodash');
    const $ = require('jquery');
    const L = require('leaflet');
    require('leaflet-draw');
    const LDrawToolbench = require('./LDrawToolbench');
    const utils = require('plugins/enhanced_tilemap/utils');

    require('leaflet-mouse-position');
    require('leaflet.nontiledlayer');
    require('./../lib/leaflet.groupedlayercontrol/groupedlayerscontrol.js');
    require('./../lib/leaflet.setview/L.Control.SetView.css');
    require('./../lib/leaflet.setview/L.Control.SetView');
    require('./../lib/leaflet.measurescale/L.Control.MeasureScale.css');
    require('./../lib/leaflet.measurescale/L.Control.MeasureScale');
    const syncMaps = require('./sync_maps');

    const defaultMapZoom = 2;
    const defaultMapCenter = [15, 5];
    const defaultMarkerType = 'Scaled Circle Markers';

    const mapTiles = {
      url: '//a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        attribution: 'Map data © <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
      }
    };
    const markerTypes = {
      'Scaled Circle Markers': Private(require('./marker_types/scaled_circles')),
      'Shaded Circle Markers': Private(require('./marker_types/shaded_circles')),
      'Shaded Geohash Grid': Private(require('./marker_types/geohash_grid')),
      'Heatmap': Private(require('./marker_types/heatmap')),
    };

    /**
     * Tile Map Maps
     *
     * @class Map
     * @constructor
     * @param container {HTML Element} Element to render map into
     * @param params {Object} Parameters used to build a map
     */
    function TileMapMap(container, params) {
      this._container = container;
      this._poiLayers = {};
      this._wmsOverlays = {};
      this._vectorOverlays = {};

      // keep a reference to all of the optional params
      this.uiState = params.uiState;
      this._callbacks = _.get(params, 'callbacks');
      this._setMarkerType(params.mapType);
      const centerArray = _.get(params, 'center') || defaultMapCenter;
      this._mapCenter = L.latLng(centerArray[0], centerArray[1]);
      this._mapZoom = _.get(params, 'zoom') || defaultMapZoom;
      this._setAttr(params.attr);
      this._isEditable = params.editable || false;

      const mapOptions = {
        minZoom: 1,
        maxZoom: 18,
        noWrap: true,
        maxBounds: L.latLngBounds([-90, -220], [90, 220]),
        scrollWheelZoom: _.get(params.attr, 'scrollWheelZoom', true),
        fadeAnimation: false,
        syncMap: params.syncMap
      };

      this._createMap(mapOptions);
    }

    TileMapMap.prototype._addDrawControl = function () {
      if (this._drawControl) return;

      //create Markers feature group and add saved markers
      this._drawnItems = new L.FeatureGroup();
      const self = this;
      this._attr.markers.forEach(function (point) {
        let color = 'green';
        if (point.length === 3) {
          color = point.pop();
        }
        self._drawnItems.addLayer(
          L.marker(
            point,
            { icon: markerIcon(color) }));
      });
      this.map.addLayer(this._drawnItems);
      this._layerControl.addOverlay(this._drawnItems, 'Markers');

      //https://github.com/Leaflet/Leaflet.draw
      const drawOptions = {
        draw: {
          circle: true,
          marker: {
            icon: markerIcon('green')
          },
          polygon: {},
          polyline: false,
          rectangle: {
            shapeOptions: {
              stroke: false,
              color: '#000'
            }
          },
          circlemarker: false
        },
        edit: {
          featureGroup: this._drawnItems,
          edit: false
        }
      };
      //Do not show marker and remove buttons when visualization is displayed in dashboard, i.e. not editable
      if (!this._isEditable) {
        drawOptions.draw.marker = false;
        drawOptions.edit.remove = false;
      }

      this._drawControl = new L.Control.Draw(drawOptions);
      this.map.addControl(this._drawControl);

      this._toolbench = new LDrawToolbench(this.map, this._drawControl);
    };

    TileMapMap.prototype._addSetViewControl = function () {
      if (this._setViewControl) return;

      this._setViewControl = new L.Control.SetView();
      this.map.addControl(this._setViewControl);
    };

    TileMapMap.prototype._addMousePositionControl = function () {
      if (this._mousePositionControl) return;

      this._mousePositionControl = L.control.mousePosition({
        emptyString: '',
        formatters: [
          function (lat, lon) {
            return L.Util.formatNum(lat, 5) + ':' + L.Util.formatNum(lon, 5);
          },
          function (lat, lon) {
            return formatcoords(lat, lon).format('DD MM ss X', {
              latLonSeparator: ':',
              decimalPlaces: 2
            });
          },
          function (lat, lon) {
            return mgrs.forward([lon, lat]);
          }
        ]
      });
      this.map.addControl(this._mousePositionControl);
    };

    /**
     * Adds label div to each map when data is split
     *
     * @method addTitle
     * @param mapLabel {String}
     * @return {undefined}
     */
    TileMapMap.prototype.addTitle = function (mapLabel) {
      if (this._label) return;

      const label = this._label = L.control();

      label.onAdd = function () {
        this._div = L.DomUtil.create('div', 'tilemap-info tilemap-label');
        this.update();
        return this._div;
      };
      label.update = function () {
        this._div.innerHTML = '<h2>' + _.escape(mapLabel) + '</h2>';
      };

      // label.addTo(this.map);
      this.map.addControl(label);
    };

    /**
     * remove css class for desat filters on map tiles
     *
     * @method saturateTiles
     * @return undefined
     */
    TileMapMap.prototype.saturateTiles = function (isDesaturated) {
      if (isDesaturated) {
        $(this._tileLayer.getContainer()).removeClass('no-filter');
      } else {
        $(this._tileLayer.getContainer()).addClass('no-filter');
      }
    };

    TileMapMap.prototype.updateSize = function () {
      this.map.invalidateSize({
        debounceMoveend: true
      });
    };

    TileMapMap.prototype.destroy = function () {
      this.clearPOILayers();
      this.clearVectorLayers();
      this._destroyMapEvents();
      if (this._label) this._label.removeFrom(this.map);
      if (this._fitControl) this._fitControl.removeFrom(this.map);
      if (this._drawControl) this._drawControl.remove(this.map);
      if (this._markers) this._markers.destroy();
      syncMaps.remove(this.map);
      this.map.remove();
      this.map = undefined;
    };

    TileMapMap.prototype.clearPOILayers = function () {
      Object.keys(this._poiLayers).forEach((key) => {
        const layer = this._poiLayers[key];
        layer.destroy();
        this._layerControl.removeLayer(layer);
        this.map.removeLayer(layer);
      });
      this._poiLayers = {};
      if (this._toolbench) this._toolbench.removeTools();
    };

    TileMapMap.prototype.clearVectorLayers = function () {
      Object.keys(this._vectorOverlays).forEach((key) => {
        const layer = this._vectorOverlays[key];
        layer.destroy();
        this._layerControl.removeLayer(layer);
        this.map.removeLayer(layer);
      });
      this._vectorOverlays = {};
      if (this._toolbench) this._toolbench.removeTools();
    };

    TileMapMap.prototype.clearWfsOverlays = function () {
      this._vectorOverlays = _.omitBy(this._vectorOverlays, overlay => {
        if (overlay.type && overlay.type === 'WFS') {
          overlay.destroy();
          this._layerControl.removeLayer(overlay);
          this.map.removeLayer(overlay);
        }
        return overlay.type && overlay.type === 'WFS';
      });
    };

    TileMapMap.prototype.addPOILayer = function (layerName, layer, layerGroup, options) {
      let isVisible = true;

      //remove layer if it already exists
      //this is required on page load with the option to have user defined POI user
      //name in edit mode as there are two watchers, i.e. vis.params and esResponse
      if (_.has(this._poiLayers, layerName)) {
        const layer = this._poiLayers[layerName];
        this._poiLayers[layerName].destroy();
        isVisible = this.map.hasLayer(layer);
        this._layerControl.removeLayer(layer);
        this.map.removeLayer(layer);
        delete this._poiLayers[layerName];
      }

      // the uiState takes precedence
      const presentInUiState = this.uiState.get(layerName);
      if (presentInUiState) {
        isVisible = true;
      } else if (presentInUiState === false) {
        isVisible = false;
      }

      if (isVisible) {
        this.map.addLayer(layer);
      }

      const tooManyDocs = {
        warningIcon: layer.$legend.tooManyDocsInfo[0],
        message: layer.$legend.tooManyDocsInfo[1]
      };

      const toomanydocslayername = layerName + ' ' + tooManyDocs.warningIcon + tooManyDocs.message;
      if (tooManyDocs.warningIcon) {
        this._layerControl.addOverlay(layer, toomanydocslayername, layerGroup || '<b> POI Overlays</b>', options);
      } else {
        this._layerControl.addOverlay(layer, layerName, layerGroup || '<b> POI Overlays</b>', options);
      }

      this._poiLayers[layerName] = layer;

      //Add tool to l.draw.toolbar so users can filter by POIs
      if (Object.keys(this._poiLayers).length === 1) {
        if (this._toolbench) this._toolbench.removeTools();
        if (!this._toolbench) this._addDrawControl();
        this._toolbench.addTool();
      }
    };

    TileMapMap.prototype.addVectorLayer = function (layerName, layer, options) {
      let isVisible;

      this._layerControl.addOverlay(layer, layerName, options.layerGroup);


      // the uiState takes precedence
      const presentInUiState = this.uiState.get(layerName);
      if (presentInUiState) {
        isVisible = true;
      } else if (presentInUiState === false) {
        isVisible = false;
      }

      if (isVisible) {
        this.map.addLayer(layer);
      }

      this._vectorOverlays[layerName] = layer;
      this._vectorOverlays[layerName].type = options.type;

      //Add tool to l.draw.toolbar so users can filter by vector layers
      if (Object.keys(this._vectorOverlays).length === 1) {
        if (this._toolbench) this._toolbench.removeTools();
        if (!this._toolbench) this._addDrawControl();
        this._toolbench.addTool();
      }
    };

    /**
     * Switch type of data overlay for map:
     * creates featurelayer from mapData (geoJson)
     *
     * @method _addMarkers
     */
    TileMapMap.prototype.addMarkers = function (chartData, newParams, tooltipFormatter, valueFormatter, collar) {
      this._setMarkerType(newParams.mapType);
      this._setAttr(newParams);
      this._chartData = chartData;
      this._geoJson = _.get(chartData, 'geoJson');
      this._collar = collar;

      let prevState = null;
      if (this._markers) {
        prevState = this._markers.destroy();
      }

      this._markers = this._createMarkers({
        uiState: this.uiState,
        tooltipFormatter: tooltipFormatter,
        valueFormatter: valueFormatter,
        prevState: prevState,
        attr: this._attr
      });
    };

    /**
     * Display geospatial filters as map layer to provide
     * users context for all applied filters
     */
    TileMapMap.prototype.addFilters = function (filters) {
      let isVisible = false;
      if (this._filters) {
        if (this.map.hasLayer(this._filters)) {
          isVisible = true;
        }
        this._layerControl.removeLayer(this._filters);
        this.map.removeLayer(this._filters);
      }

      const style = {
        fillColor: '#ccc',
        color: '#777777',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.75
      };
      this._filters = L.featureGroup(filters);
      this._filters.setStyle(style);

      // the uiState takes precedence
      const presentInUiState = this.uiState.get('Applied Filters');
      if (presentInUiState) {
        isVisible = true;
      } else if (presentInUiState === false) {
        isVisible = false;
      }

      if (isVisible) {
        this.map.addLayer(this._filters);
      }


      this._layerControl.addOverlay(this._filters, 'Applied Filters');
    };

    TileMapMap.prototype.clearWMSOverlays = function () {
      const prevState = {};
      Object.keys(this._wmsOverlays).forEach(key => {
        const layer = this._wmsOverlays[key];
        prevState[key] = this.map.hasLayer(layer);
        this._layerControl.removeLayer(layer);
        this.map.removeLayer(layer);
      });
      this._wmsOverlays = {};
      return prevState;
    };

    TileMapMap.prototype.addWmsOverlay = function (url, name, wmsOptions, layerOptions) {

      let overlay = null;
      if (layerOptions.nonTiled) {
        overlay = new L.NonTiledLayer.WMS(url, wmsOptions);
      } else {
        overlay = L.tileLayer.wms(url, wmsOptions);
      }

      overlay.layerOptions = layerOptions;

      if (layerOptions.isVisible) this.map.addLayer(overlay);


      this._layerControl.addOverlay(overlay, name, '<b> WMS Overlays</b>');
      this._wmsOverlays[name] = overlay;

      if (this._attr.isDesaturated) {
        $(overlay.getContainer()).removeClass('no-filter');
      } else {
        $(overlay.getContainer()).addClass('no-filter');
      }
    };

    TileMapMap.prototype.saturateWMSTiles = function () {
      for (const key in this._wmsOverlays) {
        if (!this._wmsOverlays.hasOwnProperty(key)) {
          continue;
        }
        if (this._attr.isDesaturated) {
          $(this._wmsOverlays[key].getContainer()).removeClass('no-filter');
        } else {
          $(this._wmsOverlays[key].getContainer()).addClass('no-filter');
        }
      }
    };

    TileMapMap.prototype.mapBounds = function () {
      let bounds = this.map.getBounds();

      //When map is not visible, there is no width or height.
      //Need to manually create bounds based on container width/height
      if (bounds.getNorthWest().equals(bounds.getSouthEast())) {
        let parent = this._container.parentNode;
        while (parent.clientWidth === 0 && parent.clientHeight === 0) {
          parent = parent.parentNode;
        }

        const southWest = this.map.layerPointToLatLng(L.point(parent.clientWidth / 2 * -1, parent.clientHeight / 2 * -1));
        const northEast = this.map.layerPointToLatLng(L.point(parent.clientWidth / 2, parent.clientHeight / 2));
        bounds = L.latLngBounds(southWest, northEast);
      }
      return bounds;
    };

    /**
     * Create the marker instance using the given options
     *
     * @method _createMarkers
     * @param options {Object} options to give to marker class
     * @return {Object} marker layer
     */
    TileMapMap.prototype._createMarkers = function (options) {
      const MarkerType = markerTypes[this._markerType];
      return new MarkerType(this.map, this._geoJson, this._layerControl, options);
    };

    TileMapMap.prototype.unfixMapTypeTooltips = function () {
      this._markers.unfixTooltips();
    };

    TileMapMap.prototype._setMarkerType = function (markerType) {
      this._markerType = markerTypes[markerType] ? markerType : defaultMarkerType;
    };

    TileMapMap.prototype._setAttr = function (attr) {
      this._attr = attr || {};

      //Ensure plugin is backwards compatible with old saved state values
      if ('static' === this._attr.scaleType) {
        this._attr.scaleType = 'Static';
      } else if ('dynamic' === this._attr.scaleType) {
        this._attr.scaleType = 'Dynamic - Linear';
      }

      //update map options based on new attributes
      if (this.map) {
        if (this._attr.scrollWheelZoom) {
          this.map.scrollWheelZoom.enable();
        } else {
          this.map.scrollWheelZoom.disable();
        }
      }
    };

    TileMapMap.prototype._destroyMapEvents = function () {
      const allEvents = [
        'draw:drawstart',
        'draw:drawstop',
        'draw:created',
        'draw:deleted',
        'setview:fitBounds',
        'groupLayerControl:removeClickedLayer',
        'moveend',
        'etm:select-feature',
        'etm:select-feature-vector',
        'toolbench:poiFilter',
        'zoomend',
        'overlayadd',
        'overlayremove'
      ];

      allEvents.forEach(event => {
        this.map.off(event);
      });
    };

    TileMapMap.prototype._attachEvents = function () {
      const self = this;

      this.map.on('groupLayerControl:removeClickedLayer', (e) => {
        const layerName = e.name;
        if (_.has(this._poiLayers, layerName)) {
          const layer = this._poiLayers[layerName];
          this._poiLayers[layerName].destroy();
          this.map.removeLayer(layer);
          delete this._poiLayers[layerName];
        }
      });

      this.map.on('etm:select-feature-vector', function (e) {
        self._callbacks.polygonVector({
          args: e.args,
          params: self._attr,
          points: e.geojson.geometry.coordinates
        });
      });

      //stop popups appearing when drawing has started
      this.map.on('draw:drawstart', function (e) {
        this.disablePopups = true;
      });

      //start popups appearing finished drawing
      this.map.on('draw:drawstop', function (e) {
        this.disablePopups = false;
      });

      this.map.on('draw:deleted', function (e) {
        self._callbacks.deleteMarkers({
          chart: self._chartData,
          deletedLayers: e.layers,
        });
      });

      this.map.on('overlayadd', function (e) {
        if (self._markers && e.name === 'Aggregation') {
          self._markers.show();
        }
      });

      this.map.on('overlayremove', function (e) {
        if (self._markers && e.name === 'Aggregation') {
          self._markers.hide();
        }
      });
    };

    TileMapMap.prototype._hasSameLocation = function () {
      const oldLat = this._mapCenter.lat.toFixed(5);
      const oldLon = this._mapCenter.lng.toFixed(5);
      const newLat = this.map.getCenter().lat.toFixed(5);
      const newLon = this.map.getCenter().lng.toFixed(5);
      let isSame = false;
      if (oldLat === newLat
        && oldLon === newLon
        && this.map.getZoom() === this._mapZoom) {
        isSame = true;
      }
      return isSame;
    };

    TileMapMap.prototype._redrawBaseLayer = function (url, options, enabled) {
      // Use WMS compliant server, if not enabled, use OSM mapTiles as default
      if (enabled) {
        this._tileLayer.remove();
        this._tileLayer = L.tileLayer.wms(url, options);
      } else {
        this._tileLayer.remove();
        this._tileLayer = L.tileLayer(mapTiles.url, mapTiles.options);
      }
      this._tileLayer.addTo(this.map);
    };

    TileMapMap.prototype._createMap = function (mapOptions) {
      if (this.map) this.destroy();

      // Use WMS compliant server, if not enabled, use OSM mapTiles as default
      if (this._attr.wms && this._attr.wms.enabled) {
        this._tileLayer = L.tileLayer.wms(this._attr.wms.url, this._attr.wms.options);
      } else {
        this._tileLayer = L.tileLayer(mapTiles.url, mapTiles.options);
      }

      mapOptions.center = this._mapCenter;
      mapOptions.zoom = this._mapZoom;

      this.map = L.map(this._container, mapOptions);

      // add base layer based on above logic and decide saturation based on saved settings
      this._tileLayer.addTo(this.map);

      this.saturateTiles(this._attr.isDesaturated);

      const options = { groupCheckboxes: true };
      this._layerControl = L.control.groupedLayers();
      this._layerControl.addTo(this.map);

      this._addSetViewControl();
      this._addDrawControl();
      this._addMousePositionControl();
      L.control.measureScale().addTo(this.map);
      this._attachEvents();
      if (mapOptions.syncMap) syncMaps.add(this.map);
    };

    /**
     * zoom map to fit all features in featureLayer,
     * even those NOT currently within map canvas extent
     *
     * @method _fitBounds
     * @param map {Leaflet Object}
     * @return {boolean}
     */
    TileMapMap.prototype.fitBounds = function (entireBounds) {
      this.map.fitBounds(entireBounds);
    };
    return TileMapMap;
  };
});
