import expect from 'expect.js';
// eslint-disable-next-line import/default
import utils from './../utils';
import { find } from 'lodash';
import { getMarkerClusteringPrecision } from './../vislib/marker_cluster_helper';

import {
  startingState,
  zoomInFromStartingState,
  zoomOutFromStartingState,
  panOutsideOfStartingStateCollar
} from './fakeUtilDrawLayerInputs';

import {
  expectedZoomInFromStartingState
} from './expectedUtilDrawLayer';

describe('Kibi Enhanced Tilemap', () => {

  describe('utils', () => {

    describe('drawLayerCheck', () => {
      const aggPrecisions = require('ui/kibi/agg_types/buckets/agg_precision_types');
      const enabledOptions = [true, false];
      const layerTypeOptions = [
        'es_ref_shape',
        'es_ref_point',
        'poi_point',
        'poi_shape',
        'agg'
      ];

      const zoomOptions = [];
      const clusteringPrecision = [];
      const aggPrecision = [];
      const createZoomAndPrecisionOptions = () => {
        for (let zoom = 0; zoom <= 18; zoom++) {
          zoomOptions.push(zoom);
          clusteringPrecision.push(getMarkerClusteringPrecision(zoom));
          aggPrecision.push(aggPrecisions.performance[zoom]);
        }
        return zoomOptions;
      };
      createZoomAndPrecisionOptions();

      it('should initialise options with correct values for "enabled" property', () => {
        const _currentMapBounds = startingState.mapBounds; // the new zoomed in map extent
        const _currentZoom = 4; // zoom has changed, but that is not important for point or agg layer types
        const _currentPrecision = 3; // precision has changed since previous layer render - THIS WILL CAUSE REDRAW
        const layerParams = startingState.layerParams; // this layer bounds covers the zoomed in area
        layerParams.type = 'agg';

        enabledOptions.forEach((enabled) => {
          layerParams.enabled = enabled;
          const redrawLayerResultEnabled = utils.drawLayerCheck(layerParams, _currentMapBounds, _currentZoom, _currentPrecision);
          expect(redrawLayerResultEnabled).to.be(enabled);
        });
      });

      it('zoomed IN map bounds check for zoom and precision', () => {
        const layerParams = zoomInFromStartingState.layerParams; // layer parameters including zoom, precision and map bounds of the last successful fetch
        const _currentMapBounds = zoomInFromStartingState.mapBounds; // the new zoomed in map extent is INSIDE the bounds that the layer has data fetched for
        layerParams.enabled = true; // always enabled, this way the other factors determine the result

        for (let layerTypeIndex = 0; layerTypeIndex <= layerTypeOptions.length - 1; layerTypeIndex++) {
          for (let zoom = 0; zoom <= zoomOptions.length - 1; zoom++) {
            layerParams.type = layerTypeOptions[layerTypeIndex];
            let precision;
            if (layerTypeOptions[layerTypeIndex] !== 'agg') {
              precision = clusteringPrecision[zoom];
            } else {
              precision = aggPrecision[zoom];
            }
            const result = utils.drawLayerCheck(layerParams, _currentMapBounds, zoom, precision);

            const expectedResult = find(expectedZoomInFromStartingState, (item) => {
              return item.type === layerParams.type &&
                item.zoom === zoom &&
                item.precision === precision;
            }).result;
            expect(result).to.be(expectedResult);
          }
        }
      });

      it('zoom IN documents with/without warning on previous extent check', () => {
        const layerParams = zoomInFromStartingState.layerParams; // layer parameters including zoom, precision and map bounds of the last successful fetch
        layerParams.enabled = true; // always enabled, this way the other factors determine the result
        layerParams.type = 'es_ref_shape';

        const _currentMapBounds = zoomInFromStartingState.mapBounds; // the new zoomed in map extent is INSIDE the bounds that the layer has data fetched for

        const zoom = 6;
        const precision = aggPrecision[zoom];

        [true, false].forEach(warning => { // true means there were too many documents to show on previous map extent
          const result = utils.drawLayerCheck(layerParams, _currentMapBounds, zoom, precision, warning);
          expect(result).to.be(warning);
        });
      });

      describe('Time filter draw checks', () => {
        [
          {
            description: 'time filter on dashboard but no time filter stored in layer',
            layerParamsTimeFilter: undefined,
            currentDashboardTimeFilter: 'there is a time filter on dashboard',
            result: true
          },
          {
            description: 'same time filter in layer and on dashboard',
            layerParamsTimeFilter: 'same time filter',
            currentDashboardTimeFilter: 'same time filter',
            result: false
          },
          {
            description: 'different time filter on dashboard than stored in layer',
            layerParamsTimeFilter: 'time filter from previous update',
            currentDashboardTimeFilter: 'dashboard time has been updated',
            result: true
          },
          {
            description: 'same time filter object test, not used in other scenarios for heightened clarity',
            layerParamsTimeFilter: {
              range: {
                funded_date: { gte: '1997-07-26T21:40:00.000Z', lte: '2013-11-20T23:59:00.000Z', format: 'strict_date_optional_time' }
              }
            },
            currentDashboardTimeFilter: {
              range: {
                funded_date: { gte: '1997-07-26T21:40:00.000Z', lte: '2013-11-20T23:59:00.000Z', format: 'strict_date_optional_time' }
              }
            },
            result: false
          },
          {
            description: 'different time filter object test, not used in other scenarios for heightened clarity',
            layerParamsTimeFilter: {
              range: {
                funded_date: { gte: '1987-07-26T21:40:00.000Z', lte: '2013-11-20T23:59:00.000Z', format: 'strict_date_optional_time' }
              }
            },
            currentDashboardTimeFilter: {
              range: {
                funded_date: { gte: '1997-07-26T21:40:00.000Z', lte: '2013-11-20T23:59:00.000Z', format: 'strict_date_optional_time' }
              }
            },
            result: true
          }
        ].forEach(scenario => {
          it(`${scenario.description}`, () => {
            const layerParams = zoomInFromStartingState.layerParams; // layer parameters including zoom, precision and map bounds of the last successful fetch
            layerParams.enabled = true; // always enabled, this way the other factors determine the result
            layerParams.type = 'es_ref_shape';

            // The same as stored in layer, this way time will determine result
            const _currentMapBounds = zoomInFromStartingState.layerParams.mapParams.mapBounds;
            const zoom = zoomInFromStartingState.layerParams.mapParams.zoomLevel;
            const precision = zoomInFromStartingState.layerParams.mapParams.precision;


            layerParams.currentTimeFilter = scenario.layerParamsTimeFilter;
            const result = utils.drawLayerCheck(layerParams, _currentMapBounds, zoom, precision, null, scenario.currentDashboardTimeFilter);
            expect(result).to.be(scenario.result);
          });
        });
      });

      it('should redraw because map zoomed outside of collar', () => {
        const layerParams = zoomOutFromStartingState.layerParams; // layer parameters including zoom, precision and map bounds of the last successful fetch
        const _currentMapBounds = zoomOutFromStartingState.mapBounds; // the new zoomed in map extent is INSIDE the bounds that the layer has data fetched for
        layerParams.enabled = true; // always enabled, this way the other factors determine the result
        layerParams.type = 'poi_shape';
        const zoom = 3;
        const precision = 3;

        const result = utils.drawLayerCheck(layerParams, _currentMapBounds, zoom, precision);

        expect(result).to.be(true);
      });

      it('should redraw because map is panned outside of current map bounds check', () => {
        const layerParams = panOutsideOfStartingStateCollar.layerParams; // layer parameters including zoom, precision and map bounds of the last successful fetch
        const _currentMapBounds = panOutsideOfStartingStateCollar.mapBounds; // the new zoomed in map extent is INSIDE the bounds that the layer has data fetched for
        layerParams.enabled = true; // always enabled, this way the other factors determine the result
        layerParams.type = 'poi_point';
        const zoom = 3;
        const precision = 3;

        const result = utils.drawLayerCheck(layerParams, _currentMapBounds, zoom, precision);

        expect(result).to.be(true);
      });
    });
  });
});