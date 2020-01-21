const L = require('leaflet');

export const markerClusteringIcon = function (thisClusterCount) { //, maxDocCount) {
  // const MIN_DOC_COUNT = 1;

  //  const iconSize = 'medium'; //set the marker size based on the min and max document count here

  // rename the "marker-cluster-small" class in the html below

  let size = 'small';
  if (thisClusterCount >= 100) {
    size = 'medium';
  } else if (thisClusterCount > 500) {
    size = 'large';
  }

  return L.divIcon({
    html: `<div class=" clustergroup0 leaflet-marker-icon marker-cluster marker-cluster-${size} leaflet-zoom-animated leaflet-clickable"
     tabindex="0" style="margin-left: -20px; margin-top: 
     -20px; width: 40px; height: 40px; z-index: 233;"><div><span>${thisClusterCount}</span></div></div>`
  });


  //  { html: '<b>' + cluster.getChildCount() + '</b>' }

};
