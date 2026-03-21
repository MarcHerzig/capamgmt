// Cluster-Typen
export type ClusterType = 'singlesite-b' | 'singlesite-z' | 'itbc';

// Host-Typ Definition
export interface HostType {
  id: string;
  name: string;           // "L", "XL", "XXL"
  sockets: number;        // 2, 4, 4
  cluster: ClusterType;   // In welchem Cluster
}

// Host-Inventar (verfügbare Hosts pro Typ)
export interface HostInventory {
  hostTypeId: string;
  totalHosts: number;     // Anzahl Hosts dieses Typs
}

// Berechnetes Inventar mit Belegung
export interface HostInventoryWithUsage extends HostInventory {
  hostType: HostType;
  totalSockets: number;   // totalHosts × sockets
  usedSockets: number;    // Von VMs belegt
  freeSockets: number;    // Verfügbar
  percentUsed: number;    // Prozent belegt
}

// VM-Typ Definition (vom User erstellt)
export interface VMType {
  id: string;
  name: string;           // z.B. "Standard", "HighMem", "GPU"
  sockets: number;        // Socket-Bedarf (0.5, 1, 1.5, 2, 3, 4)
  allowedHostTypes: string[]; // IDs der erlaubten Host-Typen
}

// Kunden-VM Zuweisung (pro Cluster)
export interface CustomerVM {
  id: string;
  customerId: string;
  vmTypeId: string;
  cluster: ClusterType;   // In welchem Cluster diese VMs laufen
  count: number;
}

// Kunde (nur Name, VMs werden separat verwaltet)
export interface Customer {
  id: string;
  name: string;
  position: number;      // Reihenfolge in der Migration
  createdAt: string;
}

// Host-Einbau Event (für Timeline)
export interface HostAddition {
  id: string;
  hostTypeId: string;
  count: number;          // Anzahl Hosts (positiv = hinzugefügt, negativ = entfernt)
  createdAt: string;
}

// Kapazitäts-Warnung
export interface CapacityWarning {
  hostType: HostType;
  freeSockets: number;
  percentUsed: number;
  needsOrdering: boolean;
}

// App-Daten für Export/Import
export interface AppData {
  version: string;
  exportedAt: string;
  hostInventory: HostInventory[];
  vmTypes: VMType[];
  customers: Customer[];
  customerVMs: CustomerVM[];
  hostAdditions: HostAddition[];
}

// Default Host-Typen
export const DEFAULT_HOST_TYPES: HostType[] = [
  // Singlesite B
  { id: 'sb-l', name: 'L', sockets: 2, cluster: 'singlesite-b' },
  { id: 'sb-xl', name: 'XL', sockets: 4, cluster: 'singlesite-b' },
  // Singlesite Z
  { id: 'sz-l', name: 'L', sockets: 2, cluster: 'singlesite-z' },
  { id: 'sz-xl', name: 'XL', sockets: 4, cluster: 'singlesite-z' },
  // ITBC
  { id: 'itbc-l', name: 'L', sockets: 2, cluster: 'itbc' },
  { id: 'itbc-xl', name: 'XL', sockets: 4, cluster: 'itbc' },
  { id: 'itbc-xxl', name: 'XXL', sockets: 4, cluster: 'itbc' },
];

// Cluster-Namen für Anzeige
export const CLUSTER_NAMES: Record<ClusterType, string> = {
  'singlesite-b': 'Singlesite B',
  'singlesite-z': 'Singlesite Z',
  'itbc': 'ITBC',
};

// Socket-Faktor pro Cluster (ITBC = 2x wegen Redundanz)
export const CLUSTER_SOCKET_FACTOR: Record<ClusterType, number> = {
  'singlesite-b': 1,
  'singlesite-z': 1,
  'itbc': 2,
};
