/* eslint-disable no-undef */
const _ = require('lodash');
const L = require('leaflet');

import { toLatLng } from 'plugins/enhanced_tilemap/vislib/geo_point';
import utils from 'plugins/enhanced_tilemap/utils';
import { markerClusteringIcon } from 'plugins/enhanced_tilemap/vislib/icons/markerClusteringIcon';
import { searchIcon } from 'plugins/enhanced_tilemap/vislib/icons/searchIcon';
import { offsetMarkerCluster } from './../marker_cluster_helper';

let oms;
export default class EsLayer {
  constructor() {
    require('overlapping-marker-spiderfier-leaflet');
  }

  createLayer = function (hits, aggs, geo, type, options) {
    let layer = null;
    const self = this;

    if ((aggs && aggs.length >= 1) || hits.length >= 1) {
      //using layer level config
      const layerControlIcon = options.icon;
      const layerControlColor = options.color;
      geo.type = geo.type.toLowerCase();
      if ('geo_point' === geo.type || 'point' === geo.type) {
        options.icon = _.get(options, 'icon', 'fas fa-map-marker-alt');
        const featuresForLayer = self._makeIndividualPoints(hits, geo, type, options)
          .concat(self._makeClusterPoints(aggs, layerControlIcon, layerControlColor, options));
        layer = new L.FeatureGroup(featuresForLayer);
        layer.type = type + '_point';
        layer.options = { pane: 'overlayPane' };
        layer.icon = `<i class="${layerControlIcon}" style="color:${layerControlColor};"></i>`;
        layer.hasCluster = aggs.length >= 1;
        layer.unspiderfy = () => {
          if (oms.unspiderfy) {
            oms.unspiderfy();
          }
        };
        layer.destroy = () => {
          layer.unbindPopup();
          if (oms.clearListeners) {
            oms.clearListeners('click');
          }
        };
        self.bindPopup(layer, options);
      } else if ('geo_shape' === geo.type ||
        'polygon' === geo.type ||
        'multipolygon' === geo.type ||
        'linestring' === geo.type ||
        'multilinestring' === geo.type) {
        const shapesWithGeometry = _.remove(hits, hit => {
          return _.get(hit, `_source[${geo.field}]`);
        });

        const shapes = _.map(shapesWithGeometry, hit => {
          const geometry = _.get(hit, `_source[${geo.field}]`);

          geometry.type = self.capitalizeFirstLetter(geometry.type);
          if (geometry.type === 'Multipolygon') {
            geometry.type = 'MultiPolygon';
          } else if (geometry.type === 'Linestring') {
            geometry.type = 'LineString';
          } else if (geometry.type === 'Multilinestring') {
            geometry.type = 'MultiLineString';
          }

          if (type === 'es_ref') {
            self.assignFeatureLevelConfigurations(hit, geo.type, options);
          }

          let popupContent = false;
          if (options.popupFields.length > 0) {
            popupContent = self._popupContent(hit, options.popupFields);
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
                polygon.content = feature.properties.label;
              }

              if (feature.geometry && (feature.geometry.type === 'Polygon' ||
                feature.geometry.type === 'MultiPolygon')) {
                polygon._click = function fireEtmSelectFeature() {
                  polygon._map.fire('etm:select-feature-vector', {
                    args: {
                      _siren: options._siren,
                      geoFieldName: options.mainVisGeoFieldName,
                      indexPattern: options.indexPattern,
                      type: feature.geometry.type
                    },
                    geojson: polygon.toGeoJSON()
                  });
                };
                polygon.on('click', polygon._click, this);
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
              fillColor: options.color || '#8510d8',
              weight: self.isLine(geo.type) ? 2 : 1,
              opacity: 0.6,
              color: self.isLine(geo.type) ? options.color : '#444444',
              fillOpacity: 0.6
            },
            destroy: function onEachFeature(feature, polygon) {
              if (feature && options.leafletMap._popup) {
                if (feature.properties.label) {
                  polygon.unbindPopup();
                }
                if (polygon._click) {
                  polygon.off('click', polygon._click, this);
                  polygon._click = null;
                }
              }
            }
          }
        );
        self.bindPopup(layer, options);
        if (options.warning && options.warning.limit) {
          layer.warning = `There are undisplayed POIs for this overlay due
        to having reached the limit currently set to ${options.warning.limit}`;
        }
        if (geo.type === 'linestring' || geo.type === 'multilinestring') {
          layer.icon = `<i class="far fa-horizontal-rule" style="color:${layerControlColor};"></i>`;
        } else {
          layer.icon = `<i class="far fa-draw-square" style="color:${layerControlColor};"></i>`;
        }
        layer.type = type + '_shape';
        layer.destroy = () => layer.options.destroy();
      } else {
        console.warn('Unexpected feature geo type: ' + geo.type);
      }

      layer.id = options.id;
      layer.label = options.displayName;


      layer.filterPopupContent = options.filterPopupContent;
      layer.close = options.close;


      if (options.visible === false) {
        layer.visible = options.visible;
      } else {
        layer.visible = true;
      }

      layer.layerGroup = options.layerGroup;

      return layer;
    } else {
      //when there is no data present for the current map canvas
      layer = L.geoJson();
      layer.id = options.id;
      layer.label = options.displayName;

      if (geo.type === 'point' || geo.type === 'geo_point') {
        layer.icon = `<i class="${options.icon}" style="color:${options.color};"></i>`;
        layer.type = type + '_point';
      } else if (geo.type === 'line') {
        layer.icon = `<i class="far fa-horizontal-rule" style="color:${options.color};"></i>`;
        layer.type = type + '_shape';
      } else {
        layer.icon = `<i class="far fa-draw-square" style="color:${options.color};"></i>`;
        layer.type = type + '_shape';
      }

      layer.options = { pane: 'overlayPane' };

      layer.visible = options.visible || true;
      return layer;
    }
  }

  isLine = function (type) {
    if (!type) return false;
    return type === 'linestring' || type === 'multilinestring';
  }

  assignFeatureLevelConfigurations = function (hit, type, options) {
    const properties = hit._source.properties;
    if (type === 'point' || type === 'geo_point') {
      options.size = properties.size || options.size || 'm';
      options.icon = properties.icon || options.icon || 'far fa-question';
    }
    options.popupFields = properties.popupFields || options.popupFields || [];
    options.color = properties.color || options.color || '#FF0000';
  }

  /**
   * Binds popup and events to each feature on map
   *
   * @method bindPopup
   * @param feature {Object}
   * @param layer {Object}
   * return {undefined}
   */
  bindPopup = function (layer, options) {
    const self = this;
    const KEEP_POPUP_OPEN_CLASS_NAMES = ['leaflet-popup', 'tooltip'];
    let clusterPolygon;

    self._popupMouseOut = function (e) {
      // get the element that the mouse hovered onto
      const target = e.toElement || e.relatedTarget;
      // check to see if the element is a popup
      if (utils.getParent(target, KEEP_POPUP_OPEN_CLASS_NAMES)) {
        return true;
      }
      // detach the event
      L.DomEvent.off(options.leafletMap._popup._container, 'mouseout', self._popupMouseOut, self);
      options.leafletMap.closePopup();
    };

    layer.on({
      mouseover: function (e) {
        if (e.layer.content) {
          // for points, polylines or polygons
          self._showTooltip(e.layer.content, e.latlng, options.leafletMap);
        } else if (e.layer.geohashRectangle) {
          //for marker clusters
          clusterPolygon = self._createClusterGeohashPolygon(e.layer.geohashRectangle, options.color)
            .addTo(options.leafletMap);
        }
      },

      mouseout: function (e) {
        if (e.layer.geohashRectangle && clusterPolygon) {
          clusterPolygon.remove(options.leafletMap);
        } else {
          const target = e.originalEvent.toElement || e.originalEvent.relatedTarget;
          // check to see if the element is a popup
          if (utils.getParent(target, KEEP_POPUP_OPEN_CLASS_NAMES)) {
            L.DomEvent.on(options.leafletMap._popup._container, 'mouseout', self._popupMouseOut, self);
            return true;
          }
          options.leafletMap.closePopup();
        }
      }
    });
  };

  _createClusterGeohashPolygon = function (rectangle, color) {
    const corners = [
      [rectangle[3][0], rectangle[3][1]],
      [rectangle[1][0], rectangle[1][1]]
    ];

    return L.rectangle(corners, {
      stroke: true,
      color,
      opacity: 0.7,
      dashArray: 4,
      fill: true,
      fillOpacity: 0.2
    });
  };

  _showTooltip = function (content, latLng, leafletMap) {
    if (!leafletMap) return;
    if (!content) return;

    const popupDimensions = {
      height: leafletMap.getSize().y * 0.9,
      width: Math.min(leafletMap.getSize().x * 0.9, 400)
    };

    L.popup({
      autoPan: false,
      maxHeight: popupDimensions.height,
      maxWidth: popupDimensions.width,
      offset: utils.popupOffset(leafletMap, content, latLng, popupDimensions)
    })
      .setLatLng(latLng)
      .setContent(content)
      .openOn(leafletMap);
  };

  addClickToGeoShape = function (polygon) {
    polygon.on('click', polygon._click);
  };

  _createHitCoords = function (hit, geoField) {
    if (_.has(hit, '_source.geometry.coordinates') && _.has(hit, '_source.geometry.type')) {
      return hit._source.geometry.coordinates;
    } else {
      return _.get(hit, `_source[${geoField}]`);
    }
  }

  _createMarker = (hit, geoField, options) => {
    const hitCoords = this._createHitCoords(hit, geoField);
    const feature = L.marker(
      toLatLng(hitCoords),
      {
        icon: searchIcon(options.icon, options.color, options.size),
        pane: 'overlayPane'
      });

    if (options.popupFields.length) {
      feature.content = this._popupContent(hit, options.popupFields);
    }

    return feature;
  };

  _popupContent = function (hit, popupFields) {
    let dlContent = '';
    if (_.isArray(popupFields)) {
      popupFields.forEach(function (field) {
        let popupFieldValue;
        if (hit._source.properties) {
          popupFieldValue = hit._source.properties[field] || hit._source[field];
        } else {
          popupFieldValue = hit._source[field];
        }

        dlContent += `<dt>${field}</dt><dd>${popupFieldValue}</dd>`;
      });
    } else {
      dlContent = popupFields;
    }
    return `<dl>${dlContent}</dl>`;
  }

  _spiderify = (leafletMap, markers, color) => {
    const options = {
      circleSpiralSwitchover: 30,
      legWeight: 1.5,
      legColors: {
        usual: '#00444444',
        highlighted: color
      },
      nearbyDistance: 20
    };
    oms = new OverlappingMarkerSpiderfier(leafletMap, options);
    markers.forEach((marker) => {
      oms.addMarker(marker);
      const popup = new L.Popup();
      oms.addListener('click', function (marker) {
        // popup.setContent(marker.content);
        popup.setLatLng(marker.getLatLng());
        leafletMap.openPopup(popup);
      });
    });
  }

  _makeIndividualPoints = (features, geo, type, options) => {
    const markerList = [];
    features.forEach((feature) => {
      if (type === 'es_ref') {
        this.assignFeatureLevelConfigurations(feature, geo.type, options);
      }
      markerList.push(this._createMarker(feature, geo.field, options));
    });

    this._spiderify(options.leafletMap, markerList, options.color);

    return markerList;
  }

  _makeClusterPoints = (features, icon, color, options) => {
    const markerList = [];
    let maxAggDocCount = 0;

    features.forEach(feature => {
      if (feature.properties.value > maxAggDocCount) maxAggDocCount = feature.properties.value;
    });

    features.forEach((feature) => {
      const markerCount = _.get(feature, 'properties.value');
      const containerPixels = {
        topLeft: options.leafletMap.latLngToContainerPoint(feature.properties.rectangle[0]),
        bottomRight: options.leafletMap.latLngToContainerPoint(feature.properties.rectangle[2]),
      };
      const clusterCentroidInPixels = options.leafletMap.latLngToContainerPoint(
        [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]
      );

      const offsetCenter = options.leafletMap.containerPointToLatLng(
        offsetMarkerCluster(containerPixels, clusterCentroidInPixels, markerCount)
      );

      const marker = L.marker(offsetCenter, {
        icon: markerClusteringIcon(markerCount, maxAggDocCount, icon, color),
        pane: 'overlayPane'
      });

      marker.geohashRectangle = feature.properties.rectangle;
      markerList.push(marker);
    });
    return markerList;
  }

  roundToTheNearest = (number, nearest) => {
    return Math.ceil(number / nearest) * nearest;
  }

  capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
}
