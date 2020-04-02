const _ = require('lodash');
const L = require('leaflet');
import { searchIcon } from 'plugins/enhanced_tilemap/vislib/searchIcon';
import { toLatLng } from 'plugins/enhanced_tilemap/vislib/geo_point';
// import { SearchSourceProvider } from 'ui/courier/data_source/search_source';
// import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
// import { onDashboardPage } from 'ui/kibi/utils/on_page';
import utils from 'plugins/enhanced_tilemap/utils';

export default class EsLayer {
  constructor() {
  }

  createLayer = function (hits, geo, type, options) {
    let layer = null;
    const self = this;

    //handling too many documents warnings
    options.$legend = options.$element.find('a.leaflet-control-layers-toggle').get(0);
    options.$legend.innerHTML = '';
    if (options.warning && options.warning.limit) {
      options.$legend.innerHTML = `<i class="fa fa-exclamation-triangle text-color-warning doc-viewer-underscore"></i>`;
    }

    if (geo) {
      geo.type = geo.type.toLowerCase();
      if ('geo_point' === geo.type || 'point' === geo.type) {
        const markers = _.map(hits, hit => {
          return self._createMarker(hit, geo.field, options);
        });
        layer = new L.FeatureGroup(markers);
        layer.type = type + 'point';
        layer.options = { pane: 'overlayPane' };
        layer.icon = `<i class="${options.searchIcon}" style="color:${options.color};"></i>`;
        layer.destroy = () => markers.forEach(self._removeMouseEventsGeoPoint);
      } else if ('geo_shape' === geo.type || 'polygon' === geo.type || 'multipolygon' === geo.type) {
        const shapes = _.map(hits, hit => {
          let geometry;
          if (type === 'poi') {
            geometry = _.get(hit, `_source[${geo.field}]`);
          } else {
            geometry = hit._source.shape;
          }
          if (geometry.type === 'multipolygon') {
            geometry.type === 'MultiPolygon';
          } else {
            geometry.type = self.capitalizeFirstLetter(geometry.type);
          }

          let popupContent = false;
          if (options.popupFields.length > 0) {
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

              if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
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
              fillColor: '#8510d8',
              weight: 2,
              opacity: 1,
              color: '#000000',
              dashArray: '3',
              fillOpacity: 0.75
            }
          }
        );
        layer.icon = `<i class="far fa-stop" style="color:${options.color};"></i>`;
        layer.type = type + 'shape';
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
        console.warn('Unexpected feature geo type: ' + geo.type);
      }

      layer.id = options.id;
      layer.label = options.displayName;

      if (options.warning && options.warning.limit) {
        layer.warning = `There are undisplayed POIs for this overlay due
      to having reached the limit currently set to ${options.warning.limit}`;
      }
      layer.filterPopupContent = options.filterPopupContent;
      layer.close = options.close;

      // layer.$legend = options.$legend;
      layer.layerGroup = options.layerGroup;

      return layer;
    } else {
      layer = L.geoJson();
      layer.id = options.id;
      layer.label = options.displayName;
      layer.icon = `<i class="far fa-question-square" style="color:${options.color};"></i>`;
      layer.options = { pane: 'overlayPane' };
      layer.type = type;
      return layer;
    }
  }

  //Mouse event creation for GeoShape
  addMouseOverGeoShape = function (e) {
    if (!e.target._map.disablePopups) {
      this.openPopup();
    }
  };
  addMouseOutToGeoShape = function (e) {
    const self = this;

    self._popupMouseOut = function (e) {
      // detach the event, if one exists
      if (self._map) {
        // get the element that the mouse hovered onto
        const target = e.toElement || e.relatedTarget;
        // check to see if the element is a popup
        if (utils.getParent(target, ['leaflet-popup'])) {
          return true;
        }
        L.DomEvent.off(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
        self.closePopup();
      }
    };

    const target = e.originalEvent.toElement || e.originalEvent.relatedTarget;

    // check to see if the element is a popup
    if (utils.getParent(target, ['leaflet-popup'])) {
      L.DomEvent.on(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
      return true;
    }
    self.closePopup();
  };
  addClickToGeoShape = function (polygon) {
    polygon.on('click', polygon._click);
  };

  //Mouse event creation and closing for GeoPoints
  _getMouseOverGeoPoint = function (content) {
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

  _addMouseOutGeoPoint = function (e) {
    const self = this;

    self._popupMouseOut = function (e) {
      // detach the event, if one exists
      if (self._map) {
        // get the element that the mouse hovered onto
        const target = e.toElement || e.relatedTarget;
        // check to see if the element is a popup
        if (utils.getParent(target, ['leaflet-popup'])) {
          return true;
        }
        L.DomEvent.off(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
        self._map.closePopup();
      }
    };

    const target = e.originalEvent.toElement || e.originalEvent.relatedTarget;

    // check to see if the element is a popup
    if (utils.getParent(target, ['leaflet-popup'])) {
      L.DomEvent.on(self._map._popup._container, 'mouseout', self._popupMouseOut, self);
      return true;
    }
    self._map.closePopup();
  };

  _addMouseEventsGeoPoint = function (feature, content) {
    feature.on('mouseover', this._getMouseOverGeoPoint(content));
    feature.on('mouseout', this._addMouseOutGeoPoint);
  };

  _removeMouseEventsGeoPoint = function (feature) {
    feature.off('mouseover');
    feature.off('mouseout');
  };

  _createMarker = function (hit, geoField, options) {
    const feature = L.marker(
      toLatLng(_.get(hit, `_source[${geoField}]`)),
      {
        icon: searchIcon(options.searchIcon, options.color, options.size),
        pane: 'overlayPane'
      });

    if (options.popupFields.length > 0) {
      const content = this._popupContent(hit, options.popupFields);
      this._addMouseEventsGeoPoint(feature, content);
    }
    return feature;
  };

  _popupContent = function (hit, popupFields) {
    let dlContent = '';
    popupFields.forEach(function (field) {
      dlContent += `<dt>${field}</dt><dd>${hit._source[field]}</dd>`;
    });
    return `<dl>${dlContent}</dl>`;
  };

  capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
}