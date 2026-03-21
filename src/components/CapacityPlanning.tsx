import { useState } from 'react';
import { useStore, useHostInventoryWithUsage, useHostInventory } from '../stores/useStore';
import { DEFAULT_HOST_TYPES, CLUSTER_NAMES, CLUSTER_SOCKET_FACTOR, ClusterType } from '../types';

function CapacityPlanning() {
  const {
    customers,
    vmTypes,
    customerVMs,
    hostAdditions,
    addHost,
    removeHost,
    deleteHostAddition,
    addCustomerVM,
    removeCustomerVM,
  } = useStore();

  const hostInventory = useHostInventory();
  const inventoryWithUsage = useHostInventoryWithUsage();

  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedCluster, setSelectedCluster] = useState<ClusterType>('singlesite-b');
  const [selectedVMType, setSelectedVMType] = useState<string>('');
  const [vmCount, setVmCount] = useState(1);

  // Get host types for selected cluster
  const clusterHostTypes = DEFAULT_HOST_TYPES.filter((ht) => ht.cluster === selectedCluster);
  const clusterInventory = inventoryWithUsage.filter((inv) => inv.hostType.cluster === selectedCluster);
  const socketFactor = CLUSTER_SOCKET_FACTOR[selectedCluster];

  // Total capacity for this cluster
  const totalClusterCapacity = clusterInventory.reduce((sum, inv) => sum + inv.totalSockets, 0);

  // Get VMs for selected cluster
  const clusterVMs = customerVMs.filter((vm) => vm.cluster === selectedCluster);

  // Calculate total used sockets in cluster
  const totalUsedSockets = clusterVMs.reduce((sum, vm) => {
    const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
    return sum + (vmType ? vm.count * vmType.sockets * socketFactor : 0);
  }, 0);

  // Check for VMs that have no compatible hosts
  const incompatibleVMs = clusterVMs.filter((vm) => {
    const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
    if (!vmType) return false;

    // Check if any of the allowed host types have hosts available
    const hasCompatibleHosts = vmType.allowedHostTypes.some((htId) => {
      const inv = hostInventory.find((i) => i.hostTypeId === htId);
      return inv && inv.totalHosts > 0;
    });

    return !hasCompatibleHosts;
  });

  // Calculate capacity per host type considering VM restrictions
  const capacityByHostType = clusterHostTypes.map((ht) => {
    const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
    const hostCount = inv?.totalHosts || 0;
    const totalSockets = hostCount * ht.sockets;

    // VMs that can run on this host type
    const compatibleVMs = clusterVMs.filter((vm) => {
      const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
      return vmType?.allowedHostTypes.includes(ht.id);
    });

    const usedSockets = compatibleVMs.reduce((sum, vm) => {
      const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
      return sum + (vmType ? vm.count * vmType.sockets * socketFactor : 0);
    }, 0);

    return {
      hostType: ht,
      hostCount,
      totalSockets,
      usedSockets,
      freeSockets: totalSockets - usedSockets,
      exceeds: usedSockets > totalSockets,
    };
  });

  // Filter VM types that can run in this cluster
  const availableVMTypes = vmTypes.filter((vt) =>
    vt.allowedHostTypes.some((htId) => clusterHostTypes.some((ht) => ht.id === htId))
  );

  // Build customer-based timeline data
  type CustomerBlock = {
    customer: typeof customers[0];
    vms: { vmTypeId: string; vmTypeName: string; count: number; sockets: number; allowedHostTypes: string[] }[];
    customerSockets: number;
    neededHostTypes: string[];
    hostsAddedBefore: typeof hostAdditions;
    runningCapacityBefore: number;
    runningCapacityAfter: number;
    runningUsageAfter: number;
    needsMoreHosts: boolean;
    missingHostTypes: string[];
    socketsShortfall: number;
  };

  const buildCustomerBlocks = (): CustomerBlock[] => {
    // Get customers with VMs in this cluster, sorted by position
    const customersWithVMs = customers
      .filter((c) => clusterVMs.some((vm) => vm.customerId === c.id))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Get host additions for this cluster, sorted by date
    const clusterHostAdditions = hostAdditions
      .filter((ha) => clusterHostTypes.some((ht) => ht.id === ha.hostTypeId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let usedHostAdditions = 0;
    let runningCapacity = 0;
    let runningUsage = 0;

    return customersWithVMs.map((customer) => {
      const customerClusterVMs = clusterVMs.filter((vm) => vm.customerId === customer.id);

      // Build VM list
      const vms = customerClusterVMs.map((vm) => {
        const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
        return {
          vmTypeId: vm.vmTypeId,
          vmTypeName: vmType?.name || '?',
          count: vm.count,
          sockets: vmType ? vm.count * vmType.sockets * socketFactor : 0,
          allowedHostTypes: vmType?.allowedHostTypes || [],
        };
      });
      const customerSockets = vms.reduce((sum, vm) => sum + vm.sockets, 0);

      // Which host types does this customer need?
      const neededHostTypes = [...new Set(vms.flatMap((vm) =>
        vm.allowedHostTypes.filter((htId) => clusterHostTypes.some((ht) => ht.id === htId))
      ))];

      // Check which host types are missing
      const missingHostTypes = neededHostTypes.filter((htId) => {
        const inv = hostInventory.find((i) => i.hostTypeId === htId);
        return !inv || inv.totalHosts <= 0;
      });

      // Hosts added before this customer (we assign hosts to customers in order)
      const runningCapacityBefore = runningCapacity;

      // Calculate how many hosts are needed for this customer
      const capacityNeeded = runningUsage + customerSockets;

      // Add hosts until we have enough capacity or run out
      const hostsForThisCustomer: typeof hostAdditions = [];
      while (usedHostAdditions < clusterHostAdditions.length && runningCapacity < capacityNeeded) {
        const ha = clusterHostAdditions[usedHostAdditions];
        const ht = DEFAULT_HOST_TYPES.find((h) => h.id === ha.hostTypeId);
        runningCapacity += (ha.count) * (ht?.sockets || 0);
        hostsForThisCustomer.push(ha);
        usedHostAdditions++;
      }

      const runningCapacityAfter = runningCapacity;
      runningUsage += customerSockets;
      const runningUsageAfter = runningUsage;

      const needsMoreHosts = runningUsageAfter > runningCapacityAfter || missingHostTypes.length > 0;
      const socketsShortfall = Math.max(0, runningUsageAfter - runningCapacityAfter);

      return {
        customer,
        vms,
        customerSockets,
        neededHostTypes,
        hostsAddedBefore: hostsForThisCustomer,
        runningCapacityBefore,
        runningCapacityAfter,
        runningUsageAfter,
        needsMoreHosts,
        missingHostTypes,
        socketsShortfall,
      };
    });
  };

  const customerBlocks = buildCustomerBlocks();

  const handleAddVM = () => {
    if (!selectedCustomer || !selectedVMType || vmCount < 1) return;
    addCustomerVM(selectedCustomer, selectedVMType, selectedCluster, vmCount);
    setVmCount(1);
  };

  const capacityExceeded = totalUsedSockets > totalClusterCapacity;

  return (
    <div className="space-y-6">
      {/* Cluster Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b">
          {(['singlesite-b', 'singlesite-z', 'itbc'] as ClusterType[]).map((cluster) => {
            const clusterInv = inventoryWithUsage.filter((inv) => inv.hostType.cluster === cluster);
            const capacity = clusterInv.reduce((sum, inv) => sum + inv.totalSockets, 0);
            const used = customerVMs
              .filter((vm) => vm.cluster === cluster)
              .reduce((sum, vm) => {
                const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
                return sum + (vmType ? vm.count * vmType.sockets * CLUSTER_SOCKET_FACTOR[cluster] : 0);
              }, 0);
            const isOverCapacity = used > capacity;

            return (
              <button
                key={cluster}
                onClick={() => setSelectedCluster(cluster)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  selectedCluster === cluster
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <div>{CLUSTER_NAMES[cluster]}</div>
                <div className={`text-xs ${isOverCapacity ? 'text-red-500' : 'text-gray-400'}`}>
                  {used}/{capacity}S {isOverCapacity && '⚠️'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Host Capacity */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">Host-Kapazität</h3>
            {selectedCluster === 'itbc' && (
              <p className="text-xs text-gray-500">Socket-Faktor: ×2</p>
            )}
          </div>
          <div className="p-4 space-y-3">
            {clusterHostTypes.map((ht) => {
              const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
              const hostCount = inv?.totalHosts || 0;
              return (
                <div key={ht.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{ht.name}</div>
                    <div className="text-xs text-gray-500">{ht.sockets}S/Host</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => removeHost(ht.id)}
                      disabled={hostCount === 0}
                      className="w-7 h-7 flex items-center justify-center bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded text-sm font-bold"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-medium">{hostCount}</span>
                    <button
                      onClick={() => addHost(ht.id)}
                      className="w-7 h-7 flex items-center justify-center bg-green-100 hover:bg-green-200 text-green-700 rounded text-sm font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t mt-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Gesamt:</span>
                <span className="font-semibold">{totalClusterCapacity} Sockets</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Belegt:</span>
                <span className={`font-semibold ${capacityExceeded ? 'text-red-600' : ''}`}>
                  {totalUsedSockets} Sockets
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Frei:</span>
                <span className={`font-semibold ${capacityExceeded ? 'text-red-600' : 'text-green-600'}`}>
                  {totalClusterCapacity - totalUsedSockets} Sockets
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Middle: Add VMs */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">VMs zuweisen</h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kunde</label>
              <select
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Kunde wählen...</option>
                {customers
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VM-Typ</label>
              <select
                value={selectedVMType}
                onChange={(e) => setSelectedVMType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">VM-Typ wählen...</option>
                {availableVMTypes.map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {vt.name} ({vt.sockets}S)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Anzahl</label>
              <input
                type="number"
                min="1"
                value={vmCount}
                onChange={(e) => setVmCount(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleAddVM}
              disabled={!selectedCustomer || !selectedVMType}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-md text-sm"
            >
              + VM hinzufügen
            </button>

            {selectedCustomer && selectedVMType && (
              <div className="text-xs text-gray-500 text-center">
                = {(() => {
                  const vmType = vmTypes.find((vt) => vt.id === selectedVMType);
                  return vmType ? vmCount * vmType.sockets * socketFactor : 0;
                })()} Sockets
              </div>
            )}
          </div>
        </div>

        {/* Right: Capacity Status */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">Status</h3>
          </div>
          <div className="p-4 space-y-3">
            {/* Incompatible VMs warning */}
            {incompatibleVMs.length > 0 && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="font-semibold text-orange-800 text-sm">⚠️ Inkompatible VMs!</div>
                <p className="text-xs text-orange-700 mt-1">
                  {incompatibleVMs.length} VM(s) haben keine passenden Hosts:
                </p>
                <ul className="text-xs text-orange-700 mt-1 list-disc list-inside">
                  {incompatibleVMs.slice(0, 3).map((vm) => {
                    const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
                    const customer = customers.find((c) => c.id === vm.customerId);
                    return (
                      <li key={vm.id}>
                        {customer?.name}: {vm.count}× {vmType?.name}
                      </li>
                    );
                  })}
                  {incompatibleVMs.length > 3 && (
                    <li>...und {incompatibleVMs.length - 3} weitere</li>
                  )}
                </ul>
              </div>
            )}

            {/* Per host type capacity */}
            {capacityByHostType.some((c) => c.hostCount > 0 || c.usedSockets > 0) && (
              <div className="space-y-2">
                {capacityByHostType
                  .filter((c) => c.hostCount > 0 || c.usedSockets > 0)
                  .map((cap) => (
                    <div key={cap.hostType.id} className="text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">{cap.hostType.name} Hosts:</span>
                        <span className={cap.exceeds ? 'text-red-600' : ''}>
                          {cap.usedSockets}/{cap.totalSockets}S
                          {cap.exceeds && ' ⚠️'}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${cap.exceeds ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{
                            width: `${Math.min(100, cap.totalSockets > 0 ? (cap.usedSockets / cap.totalSockets) * 100 : 0)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Overall status */}
            {incompatibleVMs.length > 0 ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="font-semibold text-red-800 text-sm">❌ Konfigurationsfehler</div>
                <p className="text-xs text-red-700 mt-1">
                  Passende Hosts hinzufügen!
                </p>
              </div>
            ) : capacityExceeded ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="font-semibold text-red-800 text-sm">⚠️ Kapazität überschritten!</div>
                <p className="text-xs text-red-700 mt-1">
                  {Math.abs(totalClusterCapacity - totalUsedSockets)} Sockets fehlen
                </p>
              </div>
            ) : totalClusterCapacity > 0 && clusterVMs.length > 0 ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="font-semibold text-green-800 text-sm">✓ Kapazität OK</div>
                <p className="text-xs text-green-700 mt-1">
                  {totalClusterCapacity - totalUsedSockets} Sockets frei
                </p>
              </div>
            ) : totalClusterCapacity === 0 ? (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="font-semibold text-gray-600 text-sm">Keine Hosts</div>
                <p className="text-xs text-gray-500 mt-1">
                  Füge Hosts hinzu
                </p>
              </div>
            ) : (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="font-semibold text-blue-800 text-sm">Bereit</div>
                <p className="text-xs text-blue-700 mt-1">
                  {totalClusterCapacity} Sockets verfügbar
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline - Customer-based */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-800">
            Migrations-Timeline - {CLUSTER_NAMES[selectedCluster]}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Kunden in Migrationsreihenfolge mit Host-Einbauten und VMs
          </p>
        </div>

        {customerBlocks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Keine Kunden mit VMs für diesen Cluster
          </div>
        ) : (
          <div className="divide-y-4 divide-gray-300">
            {customerBlocks.map((block, index) => (
              <div key={block.customer.id} className={`${block.needsMoreHosts ? 'bg-red-50' : ''}`}>
                {/* Customer Header */}
                <div className={`px-4 py-3 flex items-center justify-between ${
                  block.needsMoreHosts ? 'bg-red-100' : 'bg-blue-50'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 font-medium">{index + 1}.</span>
                    <span className="font-semibold text-gray-800 text-lg">👤 {block.customer.name}</span>
                    {block.needsMoreHosts && (
                      <span className="px-2 py-1 bg-red-600 text-white text-xs rounded">
                        ⚠️ Hosts benötigt!
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-600">
                      Benötigt: <span className="font-semibold">{block.customerSockets}S</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Kumulativ: {block.runningUsageAfter}S / {block.runningCapacityAfter}S
                    </div>
                  </div>
                </div>

                {/* Warning if hosts needed */}
                {block.needsMoreHosts && (
                  <div className="px-4 py-2 bg-orange-100 border-y border-orange-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-orange-800 font-semibold text-sm">
                          ⚠️ Vor dieser Migration:
                        </span>
                        {block.missingHostTypes.length > 0 && (
                          <span className="text-orange-700 text-sm ml-2">
                            Host-Typen fehlen: {block.missingHostTypes.map((htId) => {
                              const ht = DEFAULT_HOST_TYPES.find((h) => h.id === htId);
                              return ht?.name;
                            }).join(', ')}
                          </span>
                        )}
                        {block.socketsShortfall > 0 && (
                          <span className="text-orange-700 text-sm ml-2">
                            {block.socketsShortfall}S zusätzlich benötigt
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {clusterHostTypes.map((ht) => (
                          <button
                            key={ht.id}
                            onClick={() => addHost(ht.id)}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
                          >
                            +{ht.name} ({ht.sockets}S)
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Hosts added for this customer */}
                {block.hostsAddedBefore.length > 0 && (
                  <div className="px-4 py-2 bg-green-50">
                    <div className="text-xs text-gray-500 mb-1">Benötigte Hosts einbauen:</div>
                    <div className="space-y-1">
                      {block.hostsAddedBefore.map((ha) => {
                        const ht = DEFAULT_HOST_TYPES.find((h) => h.id === ha.hostTypeId);
                        return (
                          <div key={ha.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-green-700 font-medium">
                                🖥️ {ha.count > 0 ? '+' : ''}{ha.count}× {ht?.name}
                              </span>
                              <span className="text-green-600 text-xs">
                                ({(ha.count) * (ht?.sockets || 0)}S)
                              </span>
                              <span className="text-gray-400 text-xs">
                                {new Date(ha.createdAt).toLocaleDateString('de-DE')}
                              </span>
                            </div>
                            <button
                              onClick={() => deleteHostAddition(ha.id)}
                              className="text-red-600 hover:text-red-800 text-xs"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* VMs */}
                <div className="px-4 py-2">
                  <div className="text-xs text-gray-500 mb-1">VMs:</div>
                  <div className="space-y-1">
                    {block.vms.map((vm) => {
                      const customerVM = clusterVMs.find(
                        (cv) => cv.customerId === block.customer.id && cv.vmTypeId === vm.vmTypeId
                      );
                      const neededHtNames = vm.allowedHostTypes
                        .filter((htId) => clusterHostTypes.some((ht) => ht.id === htId))
                        .map((htId) => {
                          const ht = DEFAULT_HOST_TYPES.find((h) => h.id === htId);
                          const inv = hostInventory.find((i) => i.hostTypeId === htId);
                          const hasHost = inv && inv.totalHosts > 0;
                          return { name: ht?.name, hasHost };
                        });

                      return (
                        <div key={vm.vmTypeId} className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700">
                              💾 {vm.count}× {vm.vmTypeName}
                            </span>
                            <span className="text-gray-500 text-sm">
                              ({vm.sockets}S)
                            </span>
                            <div className="flex gap-1">
                              {neededHtNames.map((ht, i) => (
                                <span
                                  key={i}
                                  className={`text-xs px-1 py-0.5 rounded ${
                                    ht.hasHost
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-red-100 text-red-700'
                                  }`}
                                >
                                  {ht.name} {ht.hasHost ? '✓' : '✗'}
                                </span>
                              ))}
                            </div>
                          </div>
                          {customerVM && (
                            <button
                              onClick={() => removeCustomerVM(customerVM.id)}
                              className="text-red-600 hover:text-red-800 text-xs"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Status line */}
                <div className={`px-4 py-2 text-right text-sm ${
                  block.needsMoreHosts ? 'bg-red-100 text-red-700' : 'bg-green-50 text-green-700'
                }`}>
                  {block.needsMoreHosts ? (
                    <span>⚠️ Fehlend: {block.socketsShortfall}S</span>
                  ) : (
                    <span>✓ OK - Verbleibend: {block.runningCapacityAfter - block.runningUsageAfter}S</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick add host buttons when capacity exceeded */}
        {capacityExceeded && (
          <div className="p-4 bg-red-50 border-t border-red-200">
            <div className="text-sm font-medium text-red-800 mb-2">
              Hosts hinzufügen um Kapazität zu erhöhen:
            </div>
            <div className="flex gap-2">
              {clusterHostTypes.map((ht) => (
                <button
                  key={ht.id}
                  onClick={() => addHost(ht.id)}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded"
                >
                  + {ht.name} Host ({ht.sockets}S)
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CapacityPlanning;
