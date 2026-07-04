import React from 'react';
import { Link, Outlet } from 'react-router-dom';

class Layout extends React.Component {
  render() {
    return (
      <div>
        <nav>
          <Link to="/">Home</Link> | <Link to="/emulator">Emulator</Link>
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    );
  }
}

export default Layout;
