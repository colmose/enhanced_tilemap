

define(function (require) {
  return function MarkerClusteringFactory(Private) {

    const _ = require('lodash');
    const L = require('leaflet');
    require('leaflet.markercluster');
    // /**
    //  * Map overlay: marker clustering to show individual documents when the density is sufficient
    //  *
    //  * @param map {Leaflet Object}
    //  * @param mapData {geoJson Object}
    //  * @return {Leaflet object} featureLayer
    //  */

    function MarkerClustering(map, markers) {
      return L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: true,
        iconCreateFunction: function (cluster) {

          //Grouping the cluster returned by the server, if
          const markers = cluster.getAllChildMarkers();
          let markerCount = 0;

          markers.forEach(function (m) {
            markerCount = markerCount + m.count;
          });

          return new L.DivIcon({
            html: '<div class=" clustergroup0 leaflet-marker-icon marker-cluster' +
              'marker-cluster-medium leaflet-zoom-animated leaflet-clickable" tabindex="0" style="margin-left: -20px; ' +
              'margin-top: -20px; width: 40px; height: 40px; z-index: 233;"><div><span>' + markerCount + '</span></div></div>'
          });
        }
      });

      // this._createMarkerGroup({
      //   map: map
      // });

    }



    MarkerClustering.prototype._createMarkerGroup = function (options) {

      this._markerGroup = L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: true
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

    return MarkerClustering;
  };
});