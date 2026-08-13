import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#fff', background: '#1a1f2e', height: '100vh' }}>
          <h2>发生错误</h2>
          <pre style={{ color: '#ff8a65', fontSize: 12 }}>{this.state.error.message}</pre>
          <pre style={{ color: '#9aa0a6', fontSize: 10 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
