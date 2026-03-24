import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  VMType,
  Customer,
  CustomerVM,
  HostAddition,
  DEFAULT_HOST_TYPES,
  ClusterType,
  CLUSTER_SOCKET_FACTOR,
} from '../types';

// Utility to generate unique IDs
const generateId = () => Math.random().toString(36).substring(2, 11);

interface AppState {
  // Data
  vmTypes: VMType[];
  customers: Customer[];
  customerVMs: CustomerVM[];
  hostAdditions: HostAddition[];

  // Actions - Host Inventory
  addHost: (hostTypeId: string) => void;
  removeHost: (hostTypeId: string) => void;
  deleteHostAddition: (additionId: string) => void;

  // Actions - VM Types
  addVMType: (vmType: Omit<VMType, 'id'>) => void;
  updateVMType: (id: string, vmType: Partial<VMType>) => void;
  deleteVMType: (id: string) => void;

  // Actions - Customers
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'position'>) => void;
  updateCustomer: (id: string, customer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  moveCustomerUp: (id: string) => void;
  moveCustomerDown: (id: string) => void;

  // Actions - Customer VMs
  addCustomerVM: (customerId: string, vmTypeId: string, cluster: ClusterType, count: number) => void;
  updateCustomerVM: (vmId: string, count: number) => void;
  removeCustomerVM: (vmId: string) => void;

  // Actions - Import/Export
  exportData: () => string;
  importData: (jsonData: string) => boolean;
  resetData: () => void;
}

// Initial VM types
const initialVMTypes: VMType[] = [
  {
    id: generateId(),
    name: 'S',
    sockets: 0.5,
    allowedHostTypes: ['sb-l', 'sz-l', 'itbc-l'],
  },
  {
    id: generateId(),
    name: 'M',
    sockets: 1,
    allowedHostTypes: ['sb-l', 'sz-l', 'itbc-l'],
  },
  {
    id: generateId(),
    name: 'Large',
    sockets: 2,
    allowedHostTypes: ['sb-xl', 'sz-xl', 'itbc-xl'],
  },
  {
    id: generateId(),
    name: 'XL',
    sockets: 3,
    allowedHostTypes: ['sb-xl', 'sz-xl', 'itbc-xl'],
  },
  {
    id: generateId(),
    name: 'XLo',
    sockets: 3,
    allowedHostTypes: ['sb-xl', 'sz-xl', 'itbc-xl'],
  },
  {
    id: generateId(),
    name: 'XXL',
    sockets: 4,
    allowedHostTypes: ['itbc-xxl'],
  },
  {
    id: generateId(),
    name: '3XL',
    sockets: 4,
    allowedHostTypes: ['sb-xl', 'sz-xl', 'itbc-xl'],
  },
  {
    id: generateId(),
    name: '3XLo',
    sockets: 4,
    allowedHostTypes: ['sb-xl', 'sz-xl', 'itbc-xl'],
  },
  {
    id: generateId(),
    name: '4XL',
    sockets: 3,
    allowedHostTypes: ['itbc-xxl'],
  },
  {
    id: generateId(),
    name: '4XLo',
    sockets: 3,
    allowedHostTypes: ['itbc-xxl'],
  },
  {
    id: generateId(),
    name: '6XL',
    sockets: 4,
    allowedHostTypes: ['itbc-xxl'],
  },
  {
    id: generateId(),
    name: '6XLo',
    sockets: 4,
    allowedHostTypes: ['itbc-xxl'],
  },
];

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      vmTypes: initialVMTypes,
      customers: [],
      customerVMs: [],
      hostAdditions: [],

      // Host Inventory Actions
      addHost: (hostTypeId) =>
        set((state) => ({
          hostAdditions: [
            ...state.hostAdditions,
            {
              id: generateId(),
              hostTypeId,
              count: 1,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      removeHost: (hostTypeId) =>
        set((state) => {
          // Calculate current count from additions
          const currentCount = state.hostAdditions
            .filter((a) => a.hostTypeId === hostTypeId)
            .reduce((sum, a) => sum + a.count, 0);

          if (currentCount <= 0) return state;

          return {
            hostAdditions: [
              ...state.hostAdditions,
              {
                id: generateId(),
                hostTypeId,
                count: -1,
                createdAt: new Date().toISOString(),
              },
            ],
          };
        }),

      deleteHostAddition: (additionId) =>
        set((state) => ({
          hostAdditions: state.hostAdditions.filter((a) => a.id !== additionId),
        })),

      // VM Type Actions
      addVMType: (vmType) =>
        set((state) => ({
          vmTypes: [...state.vmTypes, { ...vmType, id: generateId() }],
        })),

      updateVMType: (id, updates) =>
        set((state) => ({
          vmTypes: state.vmTypes.map((vt) =>
            vt.id === id ? { ...vt, ...updates } : vt
          ),
        })),

      deleteVMType: (id) =>
        set((state) => ({
          vmTypes: state.vmTypes.filter((vt) => vt.id !== id),
          // Also remove all customer VMs using this type
          customerVMs: state.customerVMs.filter((vm) => vm.vmTypeId !== id),
        })),

      // Customer Actions
      addCustomer: (customer) =>
        set((state) => {
          const maxPosition = state.customers.length > 0
            ? Math.max(...state.customers.map((c) => c.position ?? 0))
            : -1;
          return {
            customers: [
              ...state.customers,
              {
                ...customer,
                id: generateId(),
                position: maxPosition + 1,
                createdAt: new Date().toISOString(),
              },
            ],
          };
        }),

      updateCustomer: (id, updates) =>
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      deleteCustomer: (id) =>
        set((state) => ({
          customers: state.customers.filter((c) => c.id !== id),
          // Also remove all VMs for this customer
          customerVMs: state.customerVMs.filter((vm) => vm.customerId !== id),
        })),

      moveCustomerUp: (id) =>
        set((state) => {
          const sorted = [...state.customers].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          const index = sorted.findIndex((c) => c.id === id);
          if (index <= 0) return state;

          const current = sorted[index];
          const above = sorted[index - 1];

          return {
            customers: state.customers.map((c) => {
              if (c.id === current.id) return { ...c, position: above.position ?? index - 1 };
              if (c.id === above.id) return { ...c, position: current.position ?? index };
              return c;
            }),
          };
        }),

      moveCustomerDown: (id) =>
        set((state) => {
          const sorted = [...state.customers].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          const index = sorted.findIndex((c) => c.id === id);
          if (index < 0 || index >= sorted.length - 1) return state;

          const current = sorted[index];
          const below = sorted[index + 1];

          return {
            customers: state.customers.map((c) => {
              if (c.id === current.id) return { ...c, position: below.position ?? index + 1 };
              if (c.id === below.id) return { ...c, position: current.position ?? index };
              return c;
            }),
          };
        }),

      // Customer VM Actions
      addCustomerVM: (customerId, vmTypeId, cluster, count) =>
        set((state) => {
          // Check if this combination already exists
          const existing = state.customerVMs.find(
            (vm) => vm.customerId === customerId && vm.vmTypeId === vmTypeId && vm.cluster === cluster
          );

          if (existing) {
            // Update count instead
            return {
              customerVMs: state.customerVMs.map((vm) =>
                vm.id === existing.id
                  ? { ...vm, count: vm.count + count }
                  : vm
              ),
            };
          }

          return {
            customerVMs: [
              ...state.customerVMs,
              {
                id: generateId(),
                customerId,
                vmTypeId,
                cluster,
                count: Math.max(1, count),
              },
            ],
          };
        }),

      updateCustomerVM: (vmId, count) =>
        set((state) => ({
          customerVMs: state.customerVMs.map((vm) =>
            vm.id === vmId ? { ...vm, count: Math.max(0, count) } : vm
          ).filter((vm) => vm.count > 0), // Remove if count is 0
        })),

      removeCustomerVM: (vmId) =>
        set((state) => ({
          customerVMs: state.customerVMs.filter((vm) => vm.id !== vmId),
        })),

      // Import/Export Actions
      exportData: () => {
        const state = get();
        const data = {
          version: '2.2.0',
          exportedAt: new Date().toISOString(),
          vmTypes: state.vmTypes,
          customers: state.customers,
          customerVMs: state.customerVMs,
          hostAdditions: state.hostAdditions,
        };
        return JSON.stringify(data, null, 2);
      },

      importData: (jsonData) => {
        try {
          const data = JSON.parse(jsonData);
          if (!data.version || !data.vmTypes || !data.customers) {
            return false;
          }
          set({
            vmTypes: data.vmTypes,
            customers: data.customers,
            customerVMs: data.customerVMs || [],
            hostAdditions: data.hostAdditions || [],
          });
          return true;
        } catch {
          return false;
        }
      },

      resetData: () =>
        set({
          vmTypes: initialVMTypes,
          customers: [],
          customerVMs: [],
          hostAdditions: [],
        }),
    }),
    {
      name: 'vm-capacity-planner-storage-v2',
    }
  )
);

// Selector: Calculate host inventory from additions
export const useHostInventory = () => {
  const { hostAdditions } = useStore();

  return DEFAULT_HOST_TYPES.map((ht) => {
    const totalHosts = hostAdditions
      .filter((a) => a.hostTypeId === ht.id)
      .reduce((sum, a) => sum + a.count, 0);

    return {
      hostTypeId: ht.id,
      totalHosts: Math.max(0, totalHosts),
    };
  });
};

// Selector: Get VMs for a specific customer
export const useCustomerVMs = (customerId: string) => {
  const { customerVMs } = useStore();
  return customerVMs.filter((vm) => vm.customerId === customerId);
};

// Selector: Get VMs for a specific cluster
export const useClusterVMs = (cluster: ClusterType) => {
  const { customerVMs } = useStore();
  return customerVMs.filter((vm) => vm.cluster === cluster);
};

// Selector: Calculate socket usage per cluster
export const useClusterSocketUsage = (cluster: ClusterType) => {
  const { customerVMs, vmTypes, customers } = useStore();
  const socketFactor = CLUSTER_SOCKET_FACTOR[cluster];

  const clusterVMs = customerVMs.filter((vm) => vm.cluster === cluster);

  // Group by customer (in migration order)
  const sortedCustomers = customers
    .filter((c) => clusterVMs.some((vm) => vm.customerId === c.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return sortedCustomers.map((customer) => {
    const customerClusterVMs = clusterVMs.filter((vm) => vm.customerId === customer.id);
    const sockets = customerClusterVMs.reduce((sum, vm) => {
      const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
      return sum + (vmType ? vm.count * vmType.sockets * socketFactor : 0);
    }, 0);

    return {
      customer,
      vms: customerClusterVMs,
      sockets,
    };
  });
};

// Selector: Host inventory with usage for a cluster
export const useHostInventoryWithUsage = () => {
  const { customerVMs, vmTypes } = useStore();
  const hostInventory = useHostInventory();

  return DEFAULT_HOST_TYPES.map((hostType) => {
    const inventory = hostInventory.find((inv) => inv.hostTypeId === hostType.id);
    const totalHosts = inventory?.totalHosts || 0;
    const totalSockets = totalHosts * hostType.sockets;

    // Calculate used sockets for this host type
    const socketFactor = CLUSTER_SOCKET_FACTOR[hostType.cluster];
    const clusterVMs = customerVMs.filter((vm) => vm.cluster === hostType.cluster);

    const usedSockets = clusterVMs.reduce((sum, vm) => {
      const vmType = vmTypes.find((vt) => vt.id === vm.vmTypeId);
      if (!vmType) return sum;
      // Check if this VM type is allowed on this host type
      if (!vmType.allowedHostTypes.includes(hostType.id)) return sum;
      return sum + vm.count * vmType.sockets * socketFactor;
    }, 0);

    const freeSockets = Math.max(0, totalSockets - usedSockets);
    const percentUsed = totalSockets > 0 ? (usedSockets / totalSockets) * 100 : 0;

    return {
      hostTypeId: hostType.id,
      totalHosts,
      hostType,
      totalSockets,
      usedSockets,
      freeSockets,
      percentUsed,
    };
  });
};

// Selector: Capacity warnings
export const useCapacityWarnings = () => {
  const inventoryWithUsage = useHostInventoryWithUsage();

  return inventoryWithUsage
    .filter((inv) => inv.totalSockets > 0 && inv.percentUsed >= 80)
    .map((inv) => ({
      hostType: inv.hostType,
      freeSockets: inv.freeSockets,
      percentUsed: inv.percentUsed,
      needsOrdering: inv.percentUsed >= 80,
    }));
};
