import { Home } from './Home';
import { Table } from './table/Table';
import { useEngine } from './useEngine';
import './App.css';

export default function App() {
  const engine = useEngine();

  if (engine.status !== 'ready') {
    return (
      <main className="home">
        <h1>RE:Forge</h1>
        {engine.status === 'connecting' ? <p className="muted">A ligar ao motor…</p> : <p className="error">{engine.failure}</p>}
      </main>
    );
  }
  return engine.game ? <Table engine={engine} game={engine.game} /> : <Home engine={engine} />;
}
