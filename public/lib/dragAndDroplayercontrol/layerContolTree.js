import React from 'react';
import { cloneDeep, findIndex, remove } from 'lodash';

import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import {
  EuiFieldSearch,
  EuiButton,
  EuiFlexItem,
  EuiFlexGroup,
  EuiButtonEmpty,
  EuiIcon
} from '@elastic/eui';
import { EuiTreeViewCheckbox } from './euiTreeViewCheckbox';
import { modalWithForm } from './../../vislib/modals/genericModal';

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export class AddMapLayersModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      items: [],
      value: '',
      selectedLayerCount: 0
    };
  }

  componentDidMount() {
    this.getItems(this.props.esClient);
  }

  _getParent = (id, list) => {
    const parentArray = id.split('/');
    parentArray.pop();
    if (parentArray.length === 0) {
      return false;
    }
    const parentPath = parentArray.join('/');
    return this._getItem(parentPath, list);
  }

  _getItem = (id, list) => {
    let foundItem;
    function findItem(items) {
      if (!foundItem) {
        for (let i = 0; i <= (items.length - 1); i++) {
          const item = items[i];
          if (item.id === id || id === '') {
            foundItem = item;
          } else if (item.id === id.substring(3)) {
            foundItem = item.children[0];
          } else if (item.group && !item.isParentItem) {
            findItem(item.children);
          }
        }
      }
    }
    findItem(list);
    return foundItem;
  }

  _calculateAllTypeCounts(list) {
    list.forEach(item => {
      if (item.group) {
        this._calculateAllTypeCounts(item.children);
        const allItemsLayer = item.children.find(it => it.isParentItem);
        allItemsLayer.count = item.count - item.children.reduce((acc, childItem) => childItem.count + acc, 0);
        if (allItemsLayer.count === 0) {
          remove(item.children, allItemsLayer);
        }
      }
    });
  }

  _makeUiTreeStructure = (aggs) => {
    const storedLayersList = [];
    aggs.forEach(agg => {
      const itemTemplate = {
        label: '',
        id: '',
        checked: false,
        filtered: false,
        children: [],
        group: false,
        count: 0,
        isParentItem: false,
        path: ''
      };

      const item = cloneDeep(itemTemplate);
      item.id = agg.key;
      item.label = capitalizeFirstLetter(agg.key.split('/')[agg.key.split('/').length - 1]);
      item.path = agg.key;
      item.count = agg.doc_count;
      item.icon = <EuiIcon type={'visMapRegion'} />;
      const parent = this._getParent(item.id, storedLayersList, item.isParentItem);
      if (parent) {
        parent.group = true;
        parent.itemInGroupChecked = true;
        parent.icon = <EuiIcon type={'folderClosed'} />;
        parent.iconWhenExpanded = <EuiIcon type={'folderOpen'} />;

        //adding option to select all layers in group
        if (!parent.hasLayerSelect) {
          parent.hasLayerSelect = true;
          const parentItem = cloneDeep(itemTemplate);
          parentItem.id = `all${parent.id}`;
          parentItem.label = `${parent.label}`;
          parentItem.path = parent.id;
          parentItem.count = 0;
          parentItem.icon = <EuiIcon type={'visMapRegion'} />;
          parentItem.isParentItem = true;
          parent.children.push(parentItem);
        }

        parent.children.push(item);
      } else {
        storedLayersList.push(item);
      }
    });
    this._calculateAllTypeCounts(storedLayersList);
    return storedLayersList;
  }

  getItems = async () => {
    const resp = await this.props.esClient.search({
      index: '.map__*',
      body: {
        query: { 'match_all': {} },
        aggs: {
          2: {
            terms: {
              field: 'spatial_path',
              order: { _key: 'asc' },
              size: 9999
            }
          }
        },
        size: 0
      }
    });

    const aggs = resp.aggregations[2].buckets;
    this.setState({
      items: this._makeUiTreeStructure(aggs)
    });
  }

  _recursivelyDrawItems(list, enabled) {
    list.forEach(async item => {
      if (item.checked && !item.group) {
        const layer = await this.props.getMriLayer(item.path, enabled);
        this.props.addOverlay(layer);

        const itemOnMapIndex = findIndex(this.props.mrisOnMap, itemOnMap => itemOnMap.id === item.id);

        item.enabled = enabled;
        if (itemOnMapIndex !== -1) {
          this.props.mrisOnMap[itemOnMapIndex] = item;
        } else {
          this.props.mrisOnMap.push(item);
        }
      }
      if (item.group) {
        this._recursivelyDrawItems(item.children, enabled);
      }
    });
  }

  _addLayersNotEnabled = async () => {
    const enabled = false;
    this._recursivelyDrawItems(this.state.items, enabled);
  }

  _addLayersEnabled = () => {
    const enabled = true;
    this._recursivelyDrawItems(this.state.items, enabled);
  }

  onClose = () => {
    if (this.props.container) {
      ReactDOM.unmountComponentAtNode(this.props.container);
    }
  };

  _filterList = (searchEntry) => {
    function recursivelyFilterList(parent) {
      // Note: item.filtered = true implies the item is NOT displayed
      parent.forEach(item => {
        const lowercase = item.label.toLowerCase();
        if (lowercase.includes(searchEntry)) {
          item.filtered = false;
          // If it has children, make all of them visible
          const nodes = [...item.children];
          while (nodes.length) {
            const node = nodes.shift();
            node.filtered = false;
            nodes.push(...node.children);
          }
          return;
        }
        // Show group node if it has atleast one child which is visible
        recursivelyFilterList(item.children);
        item.filtered = item.children ? item.children.every(child => child.filtered) : true;
      });
    }
    this.setState(prevState => {
      const list = [...prevState.items];
      recursivelyFilterList(list);
      return {
        value: searchEntry,
        items: list
      };
    });
  }

  _recursivelyToggleItemsInGroup(list, checked) {
    list.forEach(item => {
      item.checked = checked;
      if (item.group) {
        this._recursivelyToggleItemsInGroup(item.children, checked);
      }
    });
  }

  _checkIfAnyItemInGroupAndSubGroupChecked(items) {
    let checkedCount = 0;
    let totalCount = 0;

    function countChecked(items) {
      items.forEach(item => {
        if (!item.group) {
          if (item.checked) {
            checkedCount += 1;
          }
          totalCount += 1;
        }
        if (item.group) {
          countChecked(item.children);
        }

      });
    }
    countChecked(items);

    return {
      checkedCount,
      someItemsChecked: checkedCount !== totalCount && checkedCount >= 1,
      noItemsChecked: checkedCount === 0
    };
  }

  _recursivelyToggleIndeterminate(list) {
    list.forEach(item => {
      if (item.group) {
        const check = this._checkIfAnyItemInGroupAndSubGroupChecked(item.children);
        item.indeterminate = check.someItemsChecked;
        item.checked = !check.noItemsChecked;
        this._recursivelyToggleIndeterminate(item.children);
      }
    });
  }

  _toggleItems(event) {
    if (!event.id) return;
    this.setState(prevState => {
      const list = [...prevState.items];
      const item = this._getItem(event.id, list);
      item.checked = event.checked;
      if (event.isGroup) {
        if (item.group) {
          this._recursivelyToggleItemsInGroup(item.children, event.checked);
        }
      }
      this._recursivelyToggleIndeterminate(list);
      return {
        items: list,
        selectedLayerCount: this._checkIfAnyItemInGroupAndSubGroupChecked(list).checkedCount
      };
    });

  }
  render() {
    const title = 'Add Layers';
    const form = (
      <div style={{ width: '24rem' }}>
        <div>
          <EuiFieldSearch
            placeholder="Search for layers"
            value={this.state.value}
            onChange={(e) => this._filterList(e.target.value.toLowerCase())}
            isClearable={true}
            aria-label="Use aria labels when no actual label is in use"
            fullWidth={true}
          />
        </div>
        <div style={{ overflowY: 'scroll', border: '1px solid lightgrey' }}>
          <EuiTreeViewCheckbox
            onChange={(e) => this._toggleItems(e)}
            items={this.state.items}
            display={'default'}
            expandByDefault={true}
            showExpansionArrows={false}
            style={{
              height: '300px'
            }}
          />
        </div>
      </div>
    );

    const footer = (
      <EuiFlexGroup gutterSize="s" alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            data-test-subj={'addLayersModalCancelBtn'}
            size="s"
            onClick={() => {
              this.onClose();
            }}
          >
            Cancel
          </EuiButtonEmpty>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          <EuiButton
            data-test-subj={'addLayersDisabledBtn'}
            fill
            size="s"
            iconType="plusInCircle"
            onClick={() => {
              this._addLayersNotEnabled();
              this.onClose();
            }}
          >
            Add
          </EuiButton>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          {this.state.selectedLayerCount > 35 && <EuiButton
            data-test-subj={'addLayersEnableBtn'}
            size="s"
            iconType="plusInCircle"
            onClick={() => {
              this._addLayersEnabled();
              this.onClose();
            }}
            isDisabled
          >
            Add and Enable
          </EuiButton>}

          {this.state.selectedLayerCount <= 35 && <EuiButton
            data-test-subj={'addLayersEnableBtn'}
            size="s"
            iconType="plusInCircle"
            onClick={() => {
              this._addLayersEnabled();
              this.onClose();
            }}
          >
            Add and Enable
          </EuiButton>}
        </EuiFlexItem>
      </EuiFlexGroup>
    );

    return (
      modalWithForm(title, form, footer, this.onClose)
    );
  }
}
AddMapLayersModal.propTypes = {
  addOverlay: PropTypes.func.isRequired,
  mrisOnMap: PropTypes.array.isRequired,
  getMriLayer: PropTypes.func.isRequired
  // esClient: PropTypes.func.isRequired,
  // container: PropTypes.element.isRequired
};

export function showAddLayerTreeModal(esClient, addOverlay, mrisOnMap, getMriLayer) {
  const container = document.createElement('div');
  const element = (
    <AddMapLayersModal
      getMriLayer={getMriLayer}
      mrisOnMap={mrisOnMap}
      addOverlay={addOverlay}
      esClient={esClient}
      container={container}
    />
  );
  ReactDOM.render(element, container);
}


