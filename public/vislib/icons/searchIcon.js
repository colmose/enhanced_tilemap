const L = require('leaflet');

export const searchIcon = function (faIcon, color, size) {

  let iconSize = [0,0];
  switch (size) {
    case 'xs':
      faIcon = `${faIcon} fa-xs`;
      iconSize = [15,15];
      break;
    case 's':
      faIcon = `${faIcon} fa-lg`;
      iconSize = [25,25];
      break;
    case 'm':
      faIcon = `${faIcon} fa-2x`;
      iconSize = [40,40];
      break;
    case 'l':
      faIcon = `${faIcon} fa-5x`;
      iconSize = [80,80];
      break;
    case 'xl':
      faIcon = `${faIcon} fa-10x`;
      iconSize = [160,160];
      break;
  }

  return L.divIcon({
    // className is required, otherwise we get a default white square appearing in top left of html div below
    className: '',
    html: `<div data-test-subj="search-icon" class="marker-icon ${size}"><i class="${faIcon}" style="color:${color};"></i></div>`,
    iconSize,
  });

};
