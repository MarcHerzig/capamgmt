import { useState } from 'react';
import { useStore } from '../stores/useStore';

function CustomerList() {
  const { customers, addCustomer, updateCustomer, deleteCustomer } = useStore();
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

  const handlePositionChange = (customerId: string, newPosition: number) => {
    // Clamp position between 1 and customer count
    const clampedPosition = Math.max(1, Math.min(customers.length, newPosition));

    // Get current customer
    const currentCustomer = customers.find(c => c.id === customerId);
    if (!currentCustomer) return;

    const oldPosition = (currentCustomer.position ?? 0) + 1; // 1-based for display

    if (clampedPosition === oldPosition) return;

    // Reorder all customers
    const newCustomers = sortedCustomers.map((c, index) => {
      if (c.id === customerId) {
        return { ...c, position: clampedPosition - 1 }; // Convert back to 0-based
      }

      const currentPos = index;
      const targetPos = clampedPosition - 1;
      const originalPos = sortedCustomers.findIndex(sc => sc.id === customerId);

      // Shift other customers
      if (originalPos < targetPos) {
        // Moving down: shift customers between old and new position up
        if (currentPos > originalPos && currentPos <= targetPos) {
          return { ...c, position: currentPos - 1 };
        }
      } else {
        // Moving up: shift customers between new and old position down
        if (currentPos >= targetPos && currentPos < originalPos) {
          return { ...c, position: currentPos + 1 };
        }
      }

      return { ...c, position: currentPos };
    });

    // Update all customers
    newCustomers.forEach(c => {
      updateCustomer(c.id, { position: c.position });
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Kunden erfassen</h2>
          <p className="text-sm text-gray-500 mt-1">
            Erfasse hier die Kunden. Position = Migrationsreihenfolge (Nummer eingeben zum Ändern).
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
                  {/* Position input */}
                  <input
                    type="number"
                    min="1"
                    max={customers.length}
                    value={index + 1}
                    onChange={(e) => handlePositionChange(customer.id, parseInt(e.target.value) || 1)}
                    className="w-14 px-2 py-1 text-center border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    title="Position ändern"
                  />

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
