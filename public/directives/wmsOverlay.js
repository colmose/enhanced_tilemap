const _ = require('lodash');
const module = require('ui/modules').get('kibana');

define(function (require) {
  module.directive('wmsOverlay', function (indexPatterns, Private) {

    return {
      restrict: 'E',
      replace: true,
      scope: {
        layer: '='
      },
      template: require('./wmsOverlay.html'),
      link: function (scope, element, attrs) {

        scope.$watch('layer', function (layer) {
          console.log('here wms overlay');
          console.log(layer);
        });
        //console.log(scope);
        scope.zoomLevels = [];
        for (let i = 0; i <= 18; i++) {
          scope.zoomLevels.push(i);
        }
        indexPatterns.getIds().then(function (list) {
          scope.indexPatternList = list;
        });
      }
    };

  });
});
