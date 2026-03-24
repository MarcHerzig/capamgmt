import { useState } from 'react';
import { useStore, useHostInventoryWithUsage, useHostInventory } from '../stores/useStore';
import { DEFAULT_HOST_TYPES, CLUSTER_NAMES, CLUSTER_SOCKET_FACTOR, ClusterType, calculateRequiredHosts } from '../types';

function CapacityPlanning() {
  const {
    customers,
    vmTypes,
    customerVMs,
    addHost,
    removeHost,
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

  // Build customer-based timeline data with ITBC host pairing logic
  type CustomerBlock = {
    customer: typeof customers[0];
    vms: { vmTypeId: string; vmTypeName: string; count: number; sockets: number; baseSockets: number; allowedHostTypes: string[] }[];
    customerSockets: number;
    neededHostTypes: string[];
    hostsToAdd: { hostType: typeof clusterHostTypes[0]; count: number }[];
    runningHostsRequired: Record<string, number>;
    runningHostsAssigned: Record<string, number>;
    needsMoreHosts: boolean;
    missingHostTypes: string[];
    hostsShortfall: { hostType: typeof clusterHostTypes[0]; count: number }[];
  };

  const buildCustomerBlocks = (): CustomerBlock[] => {
    // Get ALL customers sorted by position (show all, even without VMs)
    const allCustomersSorted = [...customers]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Track cumulative base sockets (without 2x factor) per host type
    const cumulativeBaseSockets: Record<string, number> = {};
    clusterHostTypes.forEach((ht) => {
      cumulativeBaseSockets[ht.id] = 0;
    });

    // Track available hosts (total from inventory)
    const availableHosts: Record<string, number> = {};
    clusterHostTypes.forEach((ht) => {
      const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
      availableHosts[ht.id] = inv?.totalHosts || 0;
    });

    // Track hosts already assigned to previous customers
    const assignedHosts: Record<string, number> = {};
    clusterHostTypes.forEach((ht) => {
      assignedHosts[ht.id] = 0;
    });

    return allCustomersSorted.map((customer) => {
      const customerClusterVMs = clusterVMs.filter((vm) => vm.customerId === customer.id);

      // Build VM list with base sockets (without 2x factor)
      const vms = customerClusterVMs.map((vm) => {
        const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
        return {
          vmTypeId: vm.vmTypeId,
          vmTypeName: vmType?.name || '?',
          count: vm.count,
          sockets: vmType ? vm.count * vmType.sockets * socketFactor : 0,
          baseSockets: vmType ? vm.count * vmType.sockets : 0, // Without 2x factor
          allowedHostTypes: vmType?.allowedHostTypes || [],
        };
      });
      const customerSockets = vms.reduce((sum, vm) => sum + vm.sockets, 0);

      // Which host types does this customer need?
      const neededHostTypes = [...new Set(vms.flatMap((vm) =>
        vm.allowedHostTypes.filter((htId) => clusterHostTypes.some((ht) => ht.id === htId))
      ))];

      // Add this customer's base sockets to cumulative totals
      vms.forEach((vm) => {
        const allowedInCluster = vm.allowedHostTypes.filter((htId) =>
          clusterHostTypes.some((ht) => ht.id === htId)
        );
        if (allowedInCluster.length > 0) {
          cumulativeBaseSockets[allowedInCluster[0]] += vm.baseSockets;
        }
      });

      // Calculate hosts needed using ITBC-aware formula
      const hostsToAdd: { hostType: typeof clusterHostTypes[0]; count: number }[] = [];
      const hostsShortfall: { hostType: typeof clusterHostTypes[0]; count: number }[] = [];
      const runningHostsRequired: Record<string, number> = {};
      const runningHostsAssigned: Record<string, number> = {};
      let needsMoreHosts = false;

      clusterHostTypes.forEach((ht) => {
        const baseSockets = cumulativeBaseSockets[ht.id];
        // Use ITBC-aware calculation
        const totalHostsRequired = calculateRequiredHosts(baseSockets, ht.sockets, selectedCluster);
        runningHostsRequired[ht.id] = totalHostsRequired;

        const available = availableHosts[ht.id];
        const alreadyAssigned = assignedHosts[ht.id];

        // Hosts to add for this customer
        const newHostsNeeded = Math.max(0, totalHostsRequired - alreadyAssigned);

        if (newHostsNeeded > 0) {
          const canAssign = Math.min(newHostsNeeded, available - alreadyAssigned);
          if (canAssign > 0) {
            hostsToAdd.push({ hostType: ht, count: canAssign });
            assignedHosts[ht.id] += canAssign;
          }

          // Check if still short
          const stillNeeded = totalHostsRequired - assignedHosts[ht.id];
          if (stillNeeded > 0) {
            needsMoreHosts = true;
            hostsShortfall.push({ hostType: ht, count: stillNeeded });
          }
        }

        runningHostsAssigned[ht.id] = assignedHosts[ht.id];
      });

      // Check for missing host types (no hosts at all)
      const missingHostTypes = neededHostTypes.filter((htId) => {
        return availableHosts[htId] <= 0;
      });

      if (missingHostTypes.length > 0) {
        needsMoreHosts = true;
      }

      return {
        customer,
        vms,
        customerSockets,
        neededHostTypes,
        hostsToAdd,
        runningHostsRequired,
        runningHostsAssigned,
        needsMoreHosts,
        missingHostTypes,
        hostsShortfall,
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

        {customers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Keine Kunden erfasst
          </div>
        ) : (
          <div className="divide-y-4 divide-gray-300">
            {customerBlocks.map((block, index) => (
              <div key={block.customer.id} className={`${block.needsMoreHosts && block.vms.length > 0 ? 'bg-red-50' : ''}`}>
                {/* Customer Header */}
                <div className={`px-4 py-3 flex items-center justify-between ${
                  block.vms.length === 0
                    ? 'bg-gray-100'
                    : block.needsMoreHosts
                      ? 'bg-red-100'
                      : 'bg-blue-50'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 font-medium">{index + 1}.</span>
                    <span className={`font-semibold text-lg ${block.vms.length === 0 ? 'text-gray-500' : 'text-gray-800'}`}>
                      👤 {block.customer.name}
                    </span>
                    {block.needsMoreHosts && block.vms.length > 0 && (
                      <span className="px-2 py-1 bg-red-600 text-white text-xs rounded">
                        ⚠️ Hosts benötigt!
                      </span>
                    )}
                    {block.vms.length === 0 && (
                      <span className="text-gray-400 text-sm italic">
                        (keine VMs)
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-600">
                      Benötigt: <span className="font-semibold">{block.customerSockets}S</span>
                    </div>
                    {selectedCluster === 'itbc' && block.vms.length > 0 && (
                      <div className="text-xs text-purple-600">
                        (Primary + Failover auf versch. Hosts)
                      </div>
                    )}
                  </div>
                </div>

                {/* Warning if hosts needed */}
                {block.needsMoreHosts && block.vms.length > 0 && (
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
                        {block.hostsShortfall.length > 0 && (
                          <span className="text-orange-700 text-sm ml-2">
                            Hosts fehlen: {block.hostsShortfall.map((h) =>
                              `+${h.count}× ${h.hostType.name}`
                            ).join(', ')}
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

                {/* Hosts to add for this customer */}
                {block.hostsToAdd.length > 0 && (
                  <div className="px-4 py-2 bg-green-50">
                    <div className="text-xs text-gray-500 mb-1">Benötigte Hosts einbauen:</div>
                    <div className="space-y-1">
                      {block.hostsToAdd.map((h) => (
                        <div key={h.hostType.id} className="flex items-center gap-2">
                          <span className="text-green-700 font-medium">
                            🖥️ +{h.count}× {h.hostType.name}
                          </span>
                          <span className="text-green-600 text-xs">
                            ({h.count * h.hostType.sockets}S)
                          </span>
                          {selectedCluster === 'itbc' && (
                            <span className="text-purple-600 text-xs">
                              ({h.count / 2} Primary + {h.count / 2} Failover)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* VMs */}
                <div className="px-4 py-2">
                  <div className="text-xs text-gray-500 mb-1">VMs:</div>
                  {block.vms.length === 0 ? (
                    <div className="text-gray-400 italic text-sm py-2">
                      Keine VMs in diesem Cluster
                    </div>
                  ) : (
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
                  )}
                </div>

                {/* Status line */}
                <div className={`px-4 py-2 text-right text-sm ${
                  block.vms.length === 0
                    ? 'bg-gray-50 text-gray-500'
                    : block.needsMoreHosts
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-50 text-green-700'
                }`}>
                  {block.vms.length === 0 ? (
                    <span>— Keine VMs</span>
                  ) : block.needsMoreHosts ? (
                    <span>⚠️ Hosts fehlen: {block.hostsShortfall.map((h) =>
                      `+${h.count}× ${h.hostType.name}`
                    ).join(', ')}</span>
                  ) : (
                    <span>✓ OK</span>
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
