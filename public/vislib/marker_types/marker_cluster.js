define(function (require) {
  return function MarkerClusteringFactory(Private) {
    const _ = require('lodash');
    const L = require('leaflet');

    let BaseMarker = Private(require('./base_marker'));

    /**
     * Map overlay: marker clustering to show individual documents when the density is sufficient
     *
     * @param map {Leaflet Object}
     * @param mapData {geoJson Object}
     * @return {Leaflet object} featureLayer
     */
    _.class(MarkerClustering).inherits(BaseMarker);
    function MarkerClustering(map, geoJson, params) {
      const self = this;
      console.log(self);
      console.log(map, geoJson, params);
      MarkerClustering.Super.apply(this, arguments);

      this._createMarkerGroup({
        map: map,
        geoJson: geoJson,
        params: params
      });
    }

    MarkerClustering.prototype._createMarkerGroup = function (options) {

      this._markerGroup = L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: true,
        // iconCreateFunction: function (cluster) {

        //   //Grouping the cluster returned by the server, if
        //   const markers = cluster.getAllChildMarkers();
        //   let markerCount = 0;

        //   markers.forEach(function (m) {
        //     markerCount = markerCount + m.count;
        //   });

        //   return new L.DivIcon({
        //     html: '<div class=" clustergroup0 leaflet-marker-icon marker-cluster' +
        //       'marker-cluster-medium leaflet-zoom-animated leaflet-clickable" tabindex="0" style="margin-left: -20px; ' +
        //       'margin-top: -20px; width: 40px; height: 40px; z-index: 233;"><div><span>' + markerCount + '</span></div></div>'
        //   });
        // }
      });

      for (let i = 0; i < options.geoJson.length; i++) {
        const a = options.geoJson[i];
        const title = 'testing geohash';
        const marker = L.marker(new L.LatLng(a.geometry.coordinates[0], a.geometry.coordinates[1]), { title: title });
        marker.bindPopup(title);
        this._markerGroup.addLayer(marker);
      }
      console.log(this._markerGroup);
    };

    // /**
    // * _geohashMinDistance returns a min distance in meters for sizing
    // * circle markers to fit within geohash grid rectangle
    // *
    // * @method _geohashMinDistance
    // * @param feature {Object}
    // * @return {Number}
    // */
    // MarkerClustering.prototype._geohashMinDistance = function (feature) {
    //   let centerPoint = _.get(feature, 'properties.center');
    //   let geohashRect = _.get(feature, 'properties.rectangle');

    //   // centerPoint is an array of [lat, lng]
    //   // geohashRect is the 4 corners of the geoHash rectangle
    //   //   an array that starts at the southwest corner and proceeds
    //   //   clockwise, each value being an array of [lat, lng]

    //   // center lat and southeast lng
    //   let east = L.latLng([centerPoint[0], geohashRect[2][1]]);
    //   // southwest lat and center lng
    //   let north = L.latLng([geohashRect[3][0], centerPoint[1]]);

    //   // get latLng of geohash center point
    //   let center = L.latLng([centerPoint[0], centerPoint[1]]);

    //   // get smallest radius at center of geohash grid rectangle
    //   let eastRadius = Math.floor(center.distanceTo(east));
    //   let northRadius = Math.floor(center.distanceTo(north));
    //   return _.min([eastRadius, northRadius]);
    // };

    return MarkerClustering;
  };
});