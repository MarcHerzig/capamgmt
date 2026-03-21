import { useState } from 'react';
import { useStore } from './stores/useStore';
import CapacityPlanning from './components/CapacityPlanning';
import Overview from './components/Overview';
import CustomerList from './components/CustomerList';
import VMTypeList from './components/VMTypeList';

type Tab = 'planning' | 'overview' | 'customers' | 'vmtypes';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('planning');
  const { exportData, importData } = useStore();

  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vm-capacity-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const success = importData(content);
        if (!success) {
          alert('Fehler beim Importieren der Daten. Bitte prüfen Sie das Dateiformat.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'planning', label: 'Kapazitätsplanung', icon: '📊' },
    { id: 'overview', label: 'Übersicht', icon: '📋' },
    { id: 'customers', label: 'Kunden', icon: '👥' },
    { id: 'vmtypes', label: 'VM-Typen', icon: '💾' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800">VM Kapazitätsplaner</h1>
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
            >
              📥 Import
            </button>
            <button
              onClick={handleExport}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              📤 Export
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'planning' && <CapacityPlanning />}
        {activeTab === 'overview' && <Overview />}
        {activeTab === 'customers' && <CustomerList />}
        {activeTab === 'vmtypes' && <VMTypeList />}
      </main>
    </div>
  );
}

export default App;
