import React from 'react';
import PropTypes from 'prop-types';
// import { filter, find, forOwn } from 'lodash';
import Text from 'react-texty';
import 'react-texty/styles.css';

import {
  EuiCheckbox,
  EuiIconTip
} from '@elastic/eui';

import {
  DragDropContext,
  Droppable,
  Draggable
} from 'react-beautiful-dnd';


const getItemStyle = (isDragging, draggableStyle) => ({
  // some basic styles to make the items look a bit nicer
  userSelect: 'none',
  padding: `0 6px 0 10px`,
  borderBottom: '1px solid lightgrey',
  display: 'flex',
  // change background colour if dragging
  // background: isDragging ? '#e6e6e6' : 'none',
  margin: 0,
  height: '28px',
  lineHeight: '28px',

  // styles we need to apply on draggables
  ...draggableStyle
});

const getListStyle = () => ({
  padding: `6px 0`
});

// a little function to help us with reordering the result
const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

export class LayerControlDnd extends React.Component {

  constructor(props) {
    super(props);
    this.onDragEnd = this.onDragEnd.bind(this);
    this.state = {
      dndCurrentListOrder: props.dndCurrentListOrder
    };
  }

  componentDidUpdate() {
    const hasDifferentLength = this.props.dndCurrentListOrder.length !== this.state.dndCurrentListOrder.length;
    let hasDifferentOrder = false;
    if (!hasDifferentLength) {
      hasDifferentOrder = this.props.dndCurrentListOrder.some((item, index) => this.state.dndCurrentListOrder[index] !== item);
    }
    if (hasDifferentLength || hasDifferentOrder) {
      this.setState({
        dndCurrentListOrder: this.props.dndCurrentListOrder
      });
    }
  }

  onDragEnd(result) {
    // dropped outside the list
    if (!result.destination) {
      return;
    }

    let newDndCurrentListOrder = {};
    this.setState(({ dndCurrentListOrder }) => {
      newDndCurrentListOrder = reorder(
        dndCurrentListOrder,
        result.source.index,
        result.destination.index
      );
      this.props.dndListOrderChange(newDndCurrentListOrder, result.source.index, result.destination.index);
      return { dndCurrentListOrder: newDndCurrentListOrder };
    });

  }

  removeListItem(index, id) {
    this.setState(prevState => {
      const newListOrder = [...prevState.dndCurrentListOrder];
      newListOrder.splice(index, 1);
      this.props.dndRemoveLayerFromControl(newListOrder, id);
      return { dndCurrentListOrder: newListOrder };
    });
  }

  changeVisibility(e, layer, index) {
    const target = e.target;
    if (target) {
      this.setState(prevState => {
        const newListOrder = [...prevState.dndCurrentListOrder];
        newListOrder[index].enabled = target.checked;
        return { dndCurrentListOrder: newListOrder };
      }, () => {
        this.props.dndLayerVisibilityChange(target.checked, layer, index);
      });
    }
  }

  render() {
    const { mapContainerId } = this.props;
    return (
      <React.Fragment>
        <DragDropContext onDragEnd={this.onDragEnd}>
          <Droppable droppableId="DROPPABLE_AREA_BARE">

            {(provided, snapshot) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className={snapshot.isDraggingOver ? 'drag-in-progress' : 'drag-not-in-progress'}
                style={getListStyle(snapshot.isDraggingOver)}
              >
                {this.state.dndCurrentListOrder.map((layer, index) => (

                  <Draggable key={layer.id} draggableId={layer.id} index={index}>
                    {(provided, snapshot) => (
                      <div className='layer-control-row'
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        style={getItemStyle(
                          snapshot.isDragging,
                          provided.draggableProps.style,
                        )}
                      >
                        <span {...provided.dragHandleProps} className="panel-drag-handler">
                          <span className={'fas fa-grip-vertical'}
                          />
                        </span>

                        <span className="panel-checkbox">
                          <EuiCheckbox
                            data-test-subj={`${mapContainerId}-${layer.id}`}
                            id={`${mapContainerId}-${layer.id}`}
                            checked={layer.enabled}
                            onChange={e => this.changeVisibility(e, layer, index)}

                          />
                        </span>

                        {layer.icon && <div
                          className="iconDiv"
                          dangerouslySetInnerHTML={{
                            __html: layer.icon
                          }}></div>
                        }

                        <Text
                          tooltip={layer.type.includes('es_ref_') ? `Stored Layer: ${layer.label}` : layer.label}
                          placement="bottom"
                          tooltipStyle={{ opacity: 0.8 }}
                          showDelay={1000}
                          hideDelay={0}
                        >
                          {layer.label}
                        </Text>

                        {layer.tooManyDocsInfo && <div
                          dangerouslySetInnerHTML={{
                            __html: layer.tooManyDocsInfo
                          }}></div>
                        }

                        {layer.filterPopupContent && <EuiIconTip
                          size="m"
                          type="filter"
                          color="#006BB4"
                          position="bottom"
                          content={<div
                            dangerouslySetInnerHTML={{
                              __html: layer.filterPopupContent
                            }}>
                          </div>}
                        >
                        </EuiIconTip>
                        }

                        {layer.warning && layer.warning && <EuiIconTip
                          size="m"
                          type="alert"
                          color="warning"
                          position="bottom"
                          content={<div
                            dangerouslySetInnerHTML={{
                              __html: layer.warning
                            }}></div>}
                        >
                        </EuiIconTip>
                        }

                        {layer.close && <button
                          className="btn panel-remove"
                          onClick={() => this.removeListItem(index, layer.id)}
                        >
                          <i className="far fa-trash" />
                        </button>
                        }
                        {/* </span> */}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </React.Fragment>
    );
  }
}


LayerControlDnd.propTypes = {
  dndCurrentListOrder: PropTypes.array.isRequired,
  dndRemoveLayerFromControl: PropTypes.func.isRequired,
  dndListOrderChange: PropTypes.func.isRequired,
  dndLayerVisibilityChange: PropTypes.func.isRequired,
  mapContainerId: PropTypes.string.isRequired
};

