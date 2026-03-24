import { useStore, useHostInventory } from '../stores/useStore';
import { DEFAULT_HOST_TYPES, CLUSTER_NAMES, CLUSTER_SOCKET_FACTOR, ClusterType } from '../types';

function Overview() {
  const { customers, vmTypes, customerVMs } = useStore();
  const hostInventory = useHostInventory();

  const clusters: ClusterType[] = ['singlesite-b', 'singlesite-z', 'itbc'];

  // Sort customers by position
  const sortedCustomers = [...customers].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Get VM counts for a customer (count = number of VMs, not sockets)
  const getCustomerVMCounts = (customerId: string) => {
    const customerAllVMs = customerVMs.filter((vm) => vm.customerId === customerId);

    const total = customerAllVMs.reduce((sum, vm) => sum + vm.count, 0);
    const bew = customerAllVMs
      .filter((vm) => vm.cluster === 'singlesite-b')
      .reduce((sum, vm) => sum + vm.count, 0);
    const zoi = customerAllVMs
      .filter((vm) => vm.cluster === 'singlesite-z')
      .reduce((sum, vm) => sum + vm.count, 0);
    const itbc = customerAllVMs
      .filter((vm) => vm.cluster === 'itbc')
      .reduce((sum, vm) => sum + vm.count, 0);

    return { total, bew, zoi, itbc };
  };

  // Get data for a customer in a specific cluster
  const getCustomerClusterData = (customerId: string, cluster: ClusterType) => {
    const clusterHostTypes = DEFAULT_HOST_TYPES.filter((ht) => ht.cluster === cluster);
    const socketFactor = CLUSTER_SOCKET_FACTOR[cluster];

    const customerClusterVMs = customerVMs.filter(
      (vm) => vm.customerId === customerId && vm.cluster === cluster
    );

    if (customerClusterVMs.length === 0) {
      return {
        hasVMs: false,
        vms: [],
        totalSockets: 0,
        neededHostTypes: [],
        missingHostTypes: [],
        needsHosts: false,
      };
    }

    const vms = customerClusterVMs.map((vm) => {
      const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
      return {
        vmTypeName: vmType?.name || '?',
        count: vm.count,
        sockets: (vmType?.sockets || 0) * vm.count * socketFactor,
        allowedHostTypes: vmType?.allowedHostTypes || [],
      };
    });

    const totalSockets = vms.reduce((sum, vm) => sum + vm.sockets, 0);

    // Which host types are needed?
    const neededHostTypes = [...new Set(vms.flatMap((vm) =>
      vm.allowedHostTypes.filter((htId) => clusterHostTypes.some((ht) => ht.id === htId))
    ))];

    // Which are missing?
    const missingHostTypes = neededHostTypes.filter((htId) => {
      const inv = hostInventory.find((i) => i.hostTypeId === htId);
      return !inv || inv.totalHosts <= 0;
    });

    return {
      hasVMs: true,
      vms,
      totalSockets,
      neededHostTypes,
      missingHostTypes,
      needsHosts: missingHostTypes.length > 0,
    };
  };

  // Get host totals by size (L, XL, XXL) across all clusters
  const getHostTotalsBySize = () => {
    const sizes = ['L', 'XL', 'XXL'] as const;

    return sizes.map((size) => {
      // Find all host types of this size
      const hostTypesOfSize = DEFAULT_HOST_TYPES.filter((ht) => ht.name === size);

      // Total hosts available
      const totalHosts = hostTypesOfSize.reduce((sum, ht) => {
        const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
        return sum + (inv?.totalHosts || 0);
      }, 0);

      // Total sockets available
      const totalSockets = hostTypesOfSize.reduce((sum, ht) => {
        const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
        return sum + (inv?.totalHosts || 0) * ht.sockets;
      }, 0);

      // Used sockets - VMs that can run on this host size
      const usedSockets = hostTypesOfSize.reduce((hostSum, ht) => {
        const socketFactor = CLUSTER_SOCKET_FACTOR[ht.cluster];
        const clusterVMs = customerVMs.filter((vm) => vm.cluster === ht.cluster);

        const usedOnHost = clusterVMs.reduce((vmSum, vm) => {
          const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
          if (!vmType || !vmType.allowedHostTypes.includes(ht.id)) return vmSum;
          return vmSum + vm.count * vmType.sockets * socketFactor;
        }, 0);

        return hostSum + usedOnHost;
      }, 0);

      // Per cluster breakdown
      const perCluster = clusters.map((cluster) => {
        const clusterHostType = hostTypesOfSize.find((ht) => ht.cluster === cluster);
        if (!clusterHostType) return { cluster, hosts: 0, exists: false };

        const inv = hostInventory.find((i) => i.hostTypeId === clusterHostType.id);
        return {
          cluster,
          hosts: inv?.totalHosts || 0,
          exists: true,
        };
      });

      return {
        size,
        totalHosts,
        totalSockets,
        usedSockets,
        freeSockets: totalSockets - usedSockets,
        isOver: usedSockets > totalSockets,
        perCluster,
      };
    });
  };

  const hostTotalsBySize = getHostTotalsBySize();

  // Get cluster totals
  const getClusterTotals = (cluster: ClusterType) => {
    const clusterHostTypes = DEFAULT_HOST_TYPES.filter((ht) => ht.cluster === cluster);
    const socketFactor = CLUSTER_SOCKET_FACTOR[cluster];

    const totalCapacity = clusterHostTypes.reduce((sum, ht) => {
      const inv = hostInventory.find((i) => i.hostTypeId === ht.id);
      return sum + (inv?.totalHosts || 0) * ht.sockets;
    }, 0);

    const totalUsed = customerVMs
      .filter((vm) => vm.cluster === cluster)
      .reduce((sum, vm) => {
        const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
        return sum + (vmType ? vm.count * vmType.sockets * socketFactor : 0);
      }, 0);

    return { totalCapacity, totalUsed, isOver: totalUsed > totalCapacity };
  };

  return (
    <div className="space-y-6">
      {/* Host Types by Size - Total across all clusters */}
      <div className="grid grid-cols-3 gap-4">
        {hostTotalsBySize.map((hostSize) => (
          <div
            key={hostSize.size}
            className={`rounded-lg shadow p-4 ${
              hostSize.isOver ? 'bg-red-50' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-xl text-gray-800">{hostSize.size} Hosts</h3>
              <span className={`text-2xl font-bold ${hostSize.isOver ? 'text-red-600' : 'text-blue-600'}`}>
                {hostSize.totalHosts}
              </span>
            </div>
            <div className={`text-sm ${hostSize.isOver ? 'text-red-600' : 'text-gray-600'}`}>
              {hostSize.usedSockets} / {hostSize.totalSockets} Sockets
              {hostSize.isOver && ' ⚠️'}
            </div>
            <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${hostSize.isOver ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{
                  width: `${Math.min(100, hostSize.totalSockets > 0 ? (hostSize.usedSockets / hostSize.totalSockets) * 100 : 0)}%`,
                }}
              />
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              {hostSize.perCluster.map((pc) => (
                pc.exists && (
                  <span key={pc.cluster} className="text-gray-500">
                    {CLUSTER_NAMES[pc.cluster].split(' ')[1] || CLUSTER_NAMES[pc.cluster]}: {pc.hosts}
                  </span>
                )
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Header with cluster totals */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-800">Kunde</h3>
          <p className="text-xs text-gray-500 mt-1">{sortedCustomers.length} Kunden</p>
        </div>
        {clusters.map((cluster) => {
          const totals = getClusterTotals(cluster);
          return (
            <div
              key={cluster}
              className={`rounded-lg shadow p-4 ${
                totals.isOver ? 'bg-red-50' : 'bg-white'
              }`}
            >
              <h3 className="font-semibold text-gray-800">{CLUSTER_NAMES[cluster]}</h3>
              <p className={`text-sm mt-1 ${totals.isOver ? 'text-red-600' : 'text-gray-600'}`}>
                {totals.totalUsed} / {totals.totalCapacity} Sockets
              </p>
              {cluster === 'itbc' && (
                <p className="text-xs text-gray-400">×2 Faktor</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Customer Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-48">
                Kunde
              </th>
              {clusters.map((cluster) => (
                <th key={cluster} className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  {CLUSTER_NAMES[cluster]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedCustomers.map((customer, index) => {
              const vmCounts = getCustomerVMCounts(customer.id);
              return (
              <tr key={customer.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">{index + 1}.</span>
                    <span className="font-medium text-gray-800">{customer.name}</span>
                  </div>
                  <div className="flex gap-2 mt-1 text-xs">
                    <span className="text-gray-600">
                      {vmCounts.total} VMs
                    </span>
                    {vmCounts.bew > 0 && (
                      <span className="text-blue-600">BEW: {vmCounts.bew}</span>
                    )}
                    {vmCounts.zoi > 0 && (
                      <span className="text-purple-600">ZOI: {vmCounts.zoi}</span>
                    )}
                    {vmCounts.itbc > 0 && (
                      <span className="text-green-600">ITBC: {vmCounts.itbc}</span>
                    )}
                  </div>
                </td>
                {clusters.map((cluster) => {
                  const data = getCustomerClusterData(customer.id, cluster);

                  // Determine background color
                  let bgClass = 'bg-gray-50'; // default - no VMs
                  if (data.hasVMs) {
                    if (data.needsHosts) {
                      bgClass = 'bg-orange-100'; // needs hosts
                    } else {
                      bgClass = 'bg-green-50'; // has VMs, all good
                    }
                  }

                  return (
                    <td key={cluster} className={`px-4 py-3 ${bgClass}`}>
                      {data.hasVMs ? (
                        <div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {data.vms.map((vm, i) => (
                              <span key={i} className="text-xs bg-white px-1.5 py-0.5 rounded border">
                                {vm.count}× {vm.vmTypeName}
                              </span>
                            ))}
                          </div>
                          <div className="text-sm font-medium text-gray-700">
                            {data.totalSockets}S
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {data.neededHostTypes.map((htId) => {
                              const ht = DEFAULT_HOST_TYPES.find((h) => h.id === htId);
                              const isMissing = data.missingHostTypes.includes(htId);
                              return (
                                <span
                                  key={htId}
                                  className={`text-xs px-1 py-0.5 rounded ${
                                    isMissing
                                      ? 'bg-red-200 text-red-800'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {ht?.name} {isMissing ? '✗' : '✓'}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">0</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )})}
          </tbody>
        </table>

        {sortedCustomers.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            Keine Kunden erfasst
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-2">Legende</h3>
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-50 border rounded"></div>
            <span>Keine VMs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-green-50 border border-green-200 rounded"></div>
            <span>VMs vorhanden, Hosts OK</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-orange-100 border border-orange-300 rounded"></div>
            <span>Hosts fehlen</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">L ✓</span>
            <span>Host-Typ vorhanden</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 bg-red-200 text-red-800 text-xs rounded">L ✗</span>
            <span>Host-Typ fehlt</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Overview;
