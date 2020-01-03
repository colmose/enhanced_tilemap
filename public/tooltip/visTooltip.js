import _ from 'lodash';
import $ from 'jquery';
import utils from 'plugins/enhanced_tilemap/utils';
import { SearchSourceProvider } from 'ui/courier/data_source/search_source';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import { addSirenPropertyToVisOrSearch } from 'ui/kibi/components/dashboards360/add_property_to_vis_or_search.js';
import { findItemByVisIdAndPanelIndex } from 'ui/kibi/components/dashboards360/lib/coat/find_item_by_vis_id_and_panel_index';

define(function (require) {
  return function VisTooltipFactory(
    $compile, $rootScope, $timeout,
    getAppState, Private, savedVisualizations) {

    const geoFilter = Private(require('plugins/enhanced_tilemap/vislib/geoFilter'));
    const queryFilter = Private(FilterBarQueryFilterProvider);
    const SearchSource = Private(SearchSourceProvider);
    const $state = getAppState();
    const UI_STATE_ID = 'popupVis';

    class VisTooltip {
      constructor(visId, fieldname, geotype, sirenMeta, options) {
        this.visId = visId;
        this.fieldname = fieldname;
        this.geotype = geotype;
        this.options = options;
        this.$tooltipScope = $rootScope.$new();
        this.$visEl = null;
        this.parentUiState = $state.makeStateful('uiState');
        this.sirenMeta = sirenMeta;
      }

      destroy() {
        this.parentUiState.removeChild(UI_STATE_ID);
        this.$tooltipScope.$destroy();
        if (this.$visEl) {
          this.$visEl.remove();
        }
      }

      getFormatter() {
        const linkFn = $compile(require('./visTooltip.html'));
        let renderbot = null;
        let fetchTimestamp;

        const self = this;
        savedVisualizations.get(this.visId).then(function (savedVis) {
          self.$tooltipScope.savedObj = savedVis;
          const uiState = savedVis.uiStateJSON ? JSON.parse(savedVis.uiStateJSON) : {};
          self.$tooltipScope.uiState = self.parentUiState.createChild(UI_STATE_ID, uiState, true);
          self.$visEl = linkFn(self.$tooltipScope);
          $timeout(function () {
            renderbot = self.$visEl[0].getScope().renderbot;
          });
        });

        function createFilter(rect) {
          const bounds = utils.getRectBounds(rect);
          return geoFilter.rectFilter(self.fieldname, self.geotype, bounds.top_left, bounds.bottom_right);
        }

        return function (feature, map) {
          if (!feature) return '';
          if (!self.$visEl) return 'initializing';

          const width = Math.round(map.getSize().x * _.get(self.options, 'xRatio', 0.6));
          const height = Math.round(map.getSize().y * _.get(self.options, 'yRatio', 0.6));
          const style = 'style="height: ' + height + 'px; width: ' + width + 'px;"';
          const loadHtml = '<div ' + style + '>Loading Visualization Data</div>';

          const localFetchTimestamp = Date.now();
          fetchTimestamp = localFetchTimestamp;

          //Flag identifies that this is a record table vis, required for doc_table.js
          self.$tooltipScope.savedObj.searchSource.replaceHits = true;

          if (self.sirenMeta) {
            const panelIndexObj = {};
            const panelIndex = Math.floor(Math.random() * 10000) + 1000;
            //cloneDeep required as document count on dashboard updates when map popup is created otherwise
            const sirenMetaTooltip = _.cloneDeep(self.sirenMeta);

            //retrieving and adding popup vis to coat so that join filters work
            const etmVisNode = findItemByVisIdAndPanelIndex(
              sirenMetaTooltip.coat.items,
              self.sirenMeta.vis.id,
              self.sirenMeta.vis.panelIndex
            );

            etmVisNode.d.widgets.push({
              id: self.visId,
              panelIndex
            });

            sirenMetaTooltip.vis.id = self.visId;
            sirenMetaTooltip.vis.panelIndex = panelIndex;
            panelIndexObj.panelIndex = panelIndex;

            addSirenPropertyToVisOrSearch(self.$tooltipScope.savedObj, sirenMetaTooltip, panelIndexObj);
          };

          //adding pre-existing filter(s) and geohash specific filter to popup visualization
          self.$tooltipScope.savedObj.searchSource._state.filter = [];
          const filters = queryFilter.getFilters();
          filters.push(createFilter(feature.properties.rectangle));
          self.$tooltipScope.savedObj.searchSource.filter(filters);

          self.$tooltipScope.savedObj.searchSource.fetch().then(esResp => {
            self.$visEl.css({
              width: width,
              height: height
            });

            const $popup = $(map.getContainer()).find('.leaflet-popup-content');

            //A lot can happed between calling fetch and getting a response
            //Only update popup content if the popup context is still for this fetch
            if ($popup
              && $popup.html() === loadHtml
              && localFetchTimestamp === fetchTimestamp) {
              $popup.empty();
              $popup.append(self.$visEl);

              //query for record table is fired from doc_table.js, fired from here for all other vis
              if (self.$tooltipScope.savedObj.searchSource.vis.type.name !== 'kibi-data-table') {
                renderbot.render(esResp);
              };
            }
          });

          return loadHtml;
        };
      }
    }

    return VisTooltip;
  };
});
