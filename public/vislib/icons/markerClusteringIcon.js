const L = require('leaflet');

export const markerClusteringIcon = function (thisClusterCount, maxAggDocCount) {

  const mediumSizeThreshold = maxAggDocCount * 0.20;
  const largeSizeThreshold = maxAggDocCount * 0.85;

  let size = 'small';
  if (thisClusterCount >= mediumSizeThreshold) size = 'medium';
  if (thisClusterCount >= largeSizeThreshold) size = 'large';

  return L.divIcon({
    html: `<div class=" clustergroup0 leaflet-marker-icon marker-cluster marker-cluster-${size} leaflet-zoom-animated leaflet-clickable"
     tabindex="0" style="margin-left: -20px; margin-top: 
     -20px; width: 40px; height: 40px; z-index: 233;"><div><span>${thisClusterCount}</span></div></div>`
  });
};
