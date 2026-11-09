// Shared types for the payments feature, extracted from the monolith so the
// split child components can import them without duplicating.
import type { Location, StockLevel } from "@/lib/api/types";

export interface CartItem {
  name: string;
  /** Item type and model, matching Add Item — the identity an approved
   *  purchase needs to create the catalog item. The SKU is assigned then. */
  type: string;
  model: string;
  specification: string;
  quantity: number;
  price: number;
  locationId: string;
  image?: string;
}

export interface Transaction {
  id: string;
  recipient: string;
  recipientName?: string;
  products?: CartItem[];
  productName: string;
  description: string;
  quantity: number;
  price: number;
  status: "pending" | "processing" | "completed" | "failed";
  imageName?: string;
  itemPhoto?: string;
  receiptPhoto?: string;
  isStocked?: boolean;
  createdBy: string;
  createdAt: string;
  locationId?: string;
  locationName?: string;
  statusMessage?: string;
  paymentMethod?: string;
  paymentMetadata?: any;
}

export interface Budget {
  allocated_amount: number;
  remaining_amount: number;
  month: number;
  year: number;
}

export type { Location, StockLevel };
