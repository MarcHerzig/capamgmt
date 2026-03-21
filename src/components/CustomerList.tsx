import { useState } from 'react';
import { useStore } from '../stores/useStore';

function CustomerList() {
  const { customers, addCustomer, updateCustomer, deleteCustomer, moveCustomerUp, moveCustomerDown } = useStore();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Sort customers by position
  const sortedCustomers = [...customers].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const handleAdd = () => {
    if (!newName.trim()) return;
    addCustomer({ name: newName.trim() });
    setNewName('');
  };

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateCustomer(editingId, { name: editName.trim() });
    setEditingId(null);
    setEditName('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Kunden erfassen</h2>
          <p className="text-sm text-gray-500 mt-1">
            Erfasse hier die Kunden und ordne sie in der Migrationsreihenfolge.
          </p>
        </div>

        <div className="p-4">
          {/* Add new customer */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Kundenname eingeben..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-md"
            >
              + Hinzufügen
            </button>
          </div>

          {/* Customer list */}
          {sortedCustomers.length > 0 ? (
            <div className="space-y-2">
              {sortedCustomers.map((customer, index) => (
                <div
                  key={customer.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  {/* Position controls */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveCustomerUp(customer.id)}
                      disabled={index === 0}
                      className="w-6 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 disabled:opacity-30 disabled:hover:bg-gray-200 rounded text-xs"
                      title="Nach oben"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveCustomerDown(customer.id)}
                      disabled={index === sortedCustomers.length - 1}
                      className="w-6 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 disabled:opacity-30 disabled:hover:bg-gray-200 rounded text-xs"
                      title="Nach unten"
                    >
                      ▼
                    </button>
                  </div>

                  <span className="text-gray-400 text-sm w-6">{index + 1}.</span>

                  {editingId === customer.id ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="flex-1 px-3 py-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded"
                      >
                        Speichern
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white text-sm rounded"
                      >
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-medium text-gray-800">{customer.name}</span>
                      <button
                        onClick={() => handleStartEdit(customer.id, customer.name)}
                        className="px-3 py-1 text-blue-600 hover:bg-blue-50 text-sm rounded"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => deleteCustomer(customer.id)}
                        className="px-3 py-1 text-red-600 hover:bg-red-50 text-sm rounded"
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              Noch keine Kunden erfasst
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CustomerList;
