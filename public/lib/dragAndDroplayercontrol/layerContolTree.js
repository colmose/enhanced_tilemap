import React from 'react';
import { cloneDeep, remove } from 'lodash';

import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import {
  EuiFieldSearch,
  EuiButton,
  EuiFlexItem,
  EuiFlexGroup,
  EuiButtonEmpty,
  EuiIcon,
  EuiCallOut
} from '@elastic/eui';
import { EuiTreeViewCheckbox } from './euiTreeViewCheckbox';
import { modalWithForm } from './../../vislib/modals/genericModal';

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const ADD_LAYERS_ENABLED_THRESHOLD = 35;
export class AddMapLayersModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      items: [],
      value: '',
      selectedLayerCount: 0,
      expandByDefault: true
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
        onMap: false,
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
      item.onMap = this.props.esRefLayerOnMap(item.id);
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
          parentItem.onMap = this.props.esRefLayerOnMap(parentItem.id);
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
    const resp = await this.props.getPathList();
    let aggs = [];

    if (resp) {
      aggs = resp.aggregations[2].buckets;
    }

    this.setState({
      items: this._makeUiTreeStructure(aggs)
    });
  }

  _recursivelyDrawItems(treeList, enabled) {
    const flattenedList = [];
    const list = [...treeList];
    while (list.length) {
      const item = list.shift();
      if (item.group) {
        list.push(...item.children);
        continue;
      }
      if (item.checked) {
        item.enabled = enabled;
        flattenedList.push(item);
      }
    }
    this.props.addStoredLayers(flattenedList);
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
      if (!item.onMap) {
        item.checked = checked;
      }
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

  toggleoffexpandbydefault = () => {
    this.setState({ expandByDefault: false });
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
            toggleoffexpandbydefault={() => this.toggleoffexpandbydefault()}
            items={this.state.items}
            display={'default'}
            expandByDefault={this.state.expandByDefault}
            showExpansionArrows={false}
            style={{
              height: '300px'
            }}
          />
        </div>
        <div style={{ height: '10px' }}></div>
        <div>
          {this.state.selectedLayerCount > ADD_LAYERS_ENABLED_THRESHOLD &&
            <EuiCallOut title={`Adding multiple layers?`} color="warning" iconType="help">
              <p>When more than {`${ADD_LAYERS_ENABLED_THRESHOLD}`} layers are selected,
              only the Add option is available.</p>
              <p>To make the layers visible after they are added, select the individual
                checkbox for each layer in <b>Layer Control</b>.</p>
            </EuiCallOut>
          }
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
            data-test-subj={'addLayersEnableBtn'}
            size="s"
            iconType="plusInCircle"
            onClick={() => {
              this._addLayersEnabled();
              this.onClose();
            }}
            isDisabled={this.state.selectedLayerCount > ADD_LAYERS_ENABLED_THRESHOLD}
          >
            Add and Display
          </EuiButton>
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
      </EuiFlexGroup>
    );

    return (
      modalWithForm(title, form, footer, this.onClose)
    );
  }
}
AddMapLayersModal.propTypes = {
  addStoredLayers: PropTypes.func.isRequired,
  esRefLayerOnMap: PropTypes.func.isRequired,
  getPathList: PropTypes.func.isRequired
  // esClient: PropTypes.func.isRequired,
  // container: PropTypes.element.isRequired
};

export function showAddLayerTreeModal(esClient, addStoredLayers, esRefLayerOnMap, getPathList) {
  const container = document.createElement('div');
  const element = (
    <AddMapLayersModal
      esRefLayerOnMap={esRefLayerOnMap}
      addStoredLayers={addStoredLayers}
      getPathList={getPathList}
      esClient={esClient}
      container={container}
    />
  );
  ReactDOM.render(element, container);
}


