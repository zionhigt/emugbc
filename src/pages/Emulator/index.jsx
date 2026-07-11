import React from 'react';
import { connect } from 'react-redux';

import buildCartridge from '../../emulator/core/cartridge/Cartridge';
import { cartridgeLoaded } from '../../store/slices/emulatorSlice';

// FileReader plutôt que file.arrayBuffer() : même résultat, mais compatible
// avec tous les environnements (jsdom des tests compris)
const readBytes = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

class Emulator extends React.Component {
  handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const bytes = await readBytes(file);

    // l'instance vit sur le composant, pas dans le store (non sérialisable)
    const Cartridge = buildCartridge();
    this.cartridge = new Cartridge(bytes);

    this.props.cartridgeLoaded({ fileName: file.name, size: bytes.length });
  };

  render() {
    const { cartridge } = this.props;
    return (
      <div>
        <h1>Emulator</h1>
        <label>
          Cartouche (.gb)
          <input type="file" accept=".gb" onChange={this.handleFileChange} />
        </label>
        {cartridge && (
          <p>
            Cartouche chargée : {cartridge.fileName} ({cartridge.size} octets)
          </p>
        )}
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  cartridge: state.emulator.cartridge,
});

const mapDispatchToProps = {
  cartridgeLoaded,
};

export default connect(mapStateToProps, mapDispatchToProps)(Emulator);
