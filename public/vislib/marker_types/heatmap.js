define(function (require) {
  return function HeatmapMarkerFactory(Private) {
    const d3 = require('d3');
    const _ = require('lodash');
    const L = require('leaflet');

    const BaseMarker = Private(require('./base_marker'));

    /**
     * Map overlay: canvas layer with leaflet.heat plugin
     *
     * @param leafletMap {Leaflet Object}
     * @param geoJson {geoJson Object}
     * @param params {Object}
     */
    _.class(HeatmapMarker).inherits(BaseMarker);
    function HeatmapMarker() {
      this._disableTooltips = false;
      HeatmapMarker.Super.apply(this, arguments);

      this._createMarkerGroup({
        radius: +this._attr.heatRadius,
        blur: +this._attr.heatBlur,
        maxZoom: +this._attr.heatMaxZoom,
        minOpacity: +this._attr.heatMinOpacity
      });
    }

    /**
     * Does nothing, heatmaps don't have a legend
     *
     * @method addLegend
     * @return {undefined}
     */
    HeatmapMarker.prototype.addLegend = _.noop;

    HeatmapMarker.prototype._createMarkerGroup = function (options) {
      const max = _.get(this.geoJson, 'properties.allmax');
      const points = this._dataToHeatArray(max);

      this._markerGroup = L.heatLayer(points, options);
      this.fixTooltips();
      this._addToMap();
    };

    HeatmapMarker.prototype.unfixTooltips = function () {
      this.leafletMap.off('mousemove');
      this.leafletMap.off('mouseout');
      this.leafletMap.off('mousedown');
      this.leafletMap.off('mouseup');
    };

    HeatmapMarker.prototype.fixTooltips = function () {
      const self = this;
      const debouncedMouseMoveLocation = _.debounce(mouseMoveLocation.bind(this), 15, {
        'leading': true,
        'trailing': false
      });

      if (!this._disableTooltips && this._attr.addTooltip && this.uiState.get('Aggregation')) {
        this.leafletMap.on('mousemove', debouncedMouseMoveLocation);
        this.leafletMap.on('mouseout', function () {
          self.leafletMap.closePopup();
        });
        this.leafletMap.on('mousedown', function () {
          self._disableTooltips = true;
          self.leafletMap.closePopup();
        });
        this.leafletMap.on('mouseup', function () {
          self._disableTooltips = false;
        });
      }

      function mouseMoveLocation(e) {
        const latlng = e.latlng;

        this.leafletMap.closePopup();

        // unhighlight all svgs
        d3.selectAll('path.geohash', this.chartEl).classed('geohash-hover', false);

        if (!_.has(this, 'geoJson.features') ||  this._disableTooltips) {
          return;
        }

        // find nearest feature to event latlng
        const feature = this._nearestFeature(latlng);

        // show tooltip if close enough to event latlng
        if (this._tooltipProximity(latlng, feature)) {
          this._showTooltip(feature, latlng);
        }
      }
    };

    /**
     * returns a memoized Leaflet latLng for given geoJson feature
     *
     * @method addLatLng
     * @param feature {geoJson Object}
     * @return {Leaflet latLng Object}
     */
    HeatmapMarker.prototype._getLatLng = _.memoize(function (feature) {
      return L.latLng(
        feature.geometry.coordinates[1],
        feature.geometry.coordinates[0]
      );
    }, function (feature) {
      // turn coords into a string for the memoize cache
      return [feature.geometry.coordinates[1], feature.geometry.coordinates[0]].join(',');
    });

    /**
     * Finds nearest feature in mapData to event latlng
     *
     * @method _nearestFeature
     * @param latLng {Leaflet latLng}
     * @return nearestPoint {Leaflet latLng}
     */
    HeatmapMarker.prototype._nearestFeature = function (latLng) {
      const self = this;
      let nearest;

      if (latLng.lng < -180 || latLng.lng > 180) {
        return;
      }

      _.reduce(this.geoJson.features, function (distance, feature) {
        const featureLatLng = self._getLatLng(feature);
        const dist = latLng.distanceTo(featureLatLng);

        if (dist < distance) {
          nearest = feature;
          return dist;
        }

        return distance;
      }, Infinity);

      return nearest;
    };

    /**
     * display tooltip if feature is close enough to event latlng
     *
     * @method _tooltipProximity
     * @param latlng {Leaflet latLng  Object}
     * @param feature {geoJson Object}
     * @return {Boolean}
     */
    HeatmapMarker.prototype._tooltipProximity = function (latlng, feature) {
      if (!feature) return;

      let showTip = false;
      const featureLatLng = this._getLatLng(feature);

      // zoomScale takes map zoom and returns proximity value for tooltip display
      // domain (input values) is map zoom (min 1 and max 18)
      // range (output values) is distance in meters
      // used to compare proximity of event latlng to feature latlng
      const zoomScale = d3.scale.linear()
        .domain([1, 4, 7, 10, 13, 16, 18])
        .range([1000000, 300000, 100000, 15000, 2000, 150, 50]);

      const proximity = zoomScale(this.leafletMap.getZoom());
      const distance = latlng.distanceTo(featureLatLng);

      // maxLngDif is max difference in longitudes
      // to prevent feature tooltip from appearing 360°
      // away from event latlng
      const maxLngDif = 40;
      const lngDif = Math.abs(latlng.lng - featureLatLng.lng);

      if (distance < proximity && lngDif < maxLngDif) {
        showTip = true;
      }

      return showTip;
    };


    /**
     * returns data for data for heat map intensity
     * if heatNormalizeData attribute is checked/true
     • normalizes data for heat map intensity
     *
     * @method _dataToHeatArray
     * @param max {Number}
     * @return {Array}
     */
    HeatmapMarker.prototype._dataToHeatArray = function (max) {
      const self = this;

      if (this.geoJson && this.geoJson.features && this.geoJson.features.length > 0) {
        return this.geoJson.features.map(function (feature) {
          const lat = feature.geometry.coordinates[1];
          const lng = feature.geometry.coordinates[0];
          let heatIntensity;

          if (!self._attr.heatNormalizeData) {
            // show bucket value on heatmap
            heatIntensity = feature.properties.value;
          } else {
            // show bucket value normalized to max value
            heatIntensity = feature.properties.value / max;
          }

          return [lat, lng, heatIntensity];
        });
      } else {
        return [];
      }
    };

    return HeatmapMarker;
  };
});
