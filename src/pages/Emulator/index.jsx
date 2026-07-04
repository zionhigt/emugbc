import React from 'react';
import { connect } from 'react-redux';

import { setStatus } from '../../store/slices/emulatorSlice';

class Emulator extends React.Component {
  handleStart = () => {
    this.props.setStatus('running');
  };

  render() {
    const { status } = this.props;
    return (
      <div>
        <h1>Emulator</h1>
        <p>Status: {status}</p>
        <button onClick={this.handleStart}>Start</button>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  status: state.emulator.status,
});

const mapDispatchToProps = {
  setStatus,
};

export default connect(mapStateToProps, mapDispatchToProps)(Emulator);
