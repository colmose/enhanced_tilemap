const L = require('leaflet');

export const markerClusteringIcon = function (thisClusterCount, minDocCount, maxDocCount) {
  const MIN_DOC_COUNT = 1;

  let iconSize = 'medium'; //set the marker size based on the min and max document count here

  // rename the "marker-cluster-small" class in the html below
  return L.divIcon({
    html: `<div class=" clustergroup0 leaflet-marker-icon marker-cluster marker-cluster-small leaflet-zoom-animated 
    leaflet-clickable" tabindex="0" style="margin-left:     -20px; margin-top: -20px; width: 40px; height: 40px; 
    z-index: 233;"><div><span>' + 50 + '</span></div></div>`
  });


  //  { html: '<b>' + cluster.getChildCount() + '</b>' }

};
