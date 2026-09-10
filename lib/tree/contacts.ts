import type { ContactDetail, ContactKind, Visibility } from "../db/schema";

export type ContactState = {
	personId: string;
	name: string;
	editable: boolean;
	contacts: Pick<ContactDetail, "id" | "kind" | "value" | "label" | "visibility">[];
};

export const CONTACT_KINDS: { value: ContactKind; label: string }[] = [
	{ value: "phone", label: "Phone" },
	{ value: "email", label: "Email" },
	{ value: "whatsapp", label: "WhatsApp" },
	{ value: "address", label: "Address" },
	{ value: "instagram", label: "Instagram" },
	{ value: "linkedin", label: "LinkedIn" },
	{ value: "facebook", label: "Facebook" },
	{ value: "x", label: "X" },
	{ value: "website", label: "Website" },
	{ value: "other", label: "Other" },
];

export const CONTACT_VISIBILITY: { value: Visibility; label: string }[] = [
	{ value: "tree", label: "This family's members only" },
	{ value: "linked", label: "Members and linked families" },
	{ value: "shared", label: "Everyone with access to this family" },
];
