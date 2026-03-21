import { useState } from 'react';
import { useStore } from '../stores/useStore';
import { DEFAULT_HOST_TYPES, CLUSTER_NAMES } from '../types';

function VMTypeForm({
  onClose,
  editingId,
}: {
  onClose: () => void;
  editingId?: string | null;
}) {
  const { vmTypes, addVMType, updateVMType } = useStore();

  const vmType = editingId ? vmTypes.find((vt) => vt.id === editingId) : null;

  const [name, setName] = useState(vmType?.name || '');
  const [sockets, setSockets] = useState(vmType?.sockets || 1);

  const socketOptions = [0.5, 1, 1.5, 2, 3, 4];
  const [allowedHostTypes, setAllowedHostTypes] = useState<string[]>(
    vmType?.allowedHostTypes || []
  );

  const handleToggleHostType = (hostTypeId: string) => {
    setAllowedHostTypes((prev) =>
      prev.includes(hostTypeId)
        ? prev.filter((id) => id !== hostTypeId)
        : [...prev, hostTypeId]
    );
  };

  const handleSave = () => {
    if (!name.trim() || allowedHostTypes.length === 0) return;

    if (vmType) {
      updateVMType(vmType.id, { name, sockets, allowedHostTypes });
    } else {
      addVMType({ name, sockets, allowedHostTypes });
    }
    onClose();
  };

  // Group host types by cluster
  const hostTypesByCluster = DEFAULT_HOST_TYPES.reduce((acc, ht) => {
    if (!acc[ht.cluster]) acc[ht.cluster] = [];
    acc[ht.cluster].push(ht);
    return acc;
  }, {} as Record<string, typeof DEFAULT_HOST_TYPES>);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-4">
      <h3 className="font-semibold text-gray-800 mb-4">
        {vmType ? 'VM-Typ bearbeiten' : 'Neuer VM-Typ'}
      </h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="z.B. Standard, HighMem, GPU"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sockets</label>
          <select
            value={sockets}
            onChange={(e) => setSockets(parseFloat(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {socketOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt} {opt === 1 ? 'Socket' : 'Sockets'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Erlaubte Host-Typen
        </label>
        <div className="space-y-3">
          {Object.entries(hostTypesByCluster).map(([cluster, hostTypes]) => (
            <div key={cluster} className="bg-white p-3 rounded border border-gray-200">
              <div className="text-sm font-medium text-gray-600 mb-2">
                {CLUSTER_NAMES[cluster as keyof typeof CLUSTER_NAMES]}
              </div>
              <div className="flex flex-wrap gap-2">
                {hostTypes.map((ht) => (
                  <label
                    key={ht.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
                      allowedHostTypes.includes(ht.id)
                        ? 'bg-blue-100 text-blue-800 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={allowedHostTypes.includes(ht.id)}
                      onChange={() => handleToggleHostType(ht.id)}
                      className="sr-only"
                    />
                    <span>
                      {ht.name} ({ht.sockets} Sockets)
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {allowedHostTypes.length === 0 && (
          <p className="text-sm text-red-500 mt-2">
            Mindestens ein Host-Typ muss ausgewählt werden
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
        >
          Abbrechen
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || allowedHostTypes.length === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-md"
        >
          {vmType ? 'Speichern' : 'Erstellen'}
        </button>
      </div>
    </div>
  );
}

function VMTypeList() {
  const { vmTypes, deleteVMType } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const getHostTypeNames = (allowedHostTypes: string[]) => {
    return allowedHostTypes
      .map((id) => {
        const ht = DEFAULT_HOST_TYPES.find((h) => h.id === id);
        return ht ? `${ht.name} (${CLUSTER_NAMES[ht.cluster]})` : id;
      })
      .join(', ');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800">VM-Typen</h2>
          <button
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm"
          >
            + Neuer VM-Typ
          </button>
        </div>

        <div className="p-4">
          {vmTypes.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Sockets</th>
                  <th className="px-4 py-2">Erlaubte Hosts</th>
                  <th className="px-4 py-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {vmTypes.map((vmType) => (
                  <tr
                    key={vmType.id}
                    className="hover:bg-gray-50 border-b border-gray-100"
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{vmType.name}</td>
                    <td className="px-4 py-3 text-gray-600">{vmType.sockets}</td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {getHostTypeNames(vmType.allowedHostTypes)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingId(vmType.id);
                            setShowForm(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          ✏️ Bearbeiten
                        </button>
                        <button
                          onClick={() => deleteVMType(vmType.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          🗑️ Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center text-gray-500 py-8">
              Noch keine VM-Typen angelegt
            </div>
          )}

          {showForm && (
            <VMTypeForm
              editingId={editingId}
              onClose={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default VMTypeList;
