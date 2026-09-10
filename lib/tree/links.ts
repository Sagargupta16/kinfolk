export type LinkCandidate = {
	id: string;
	name: string;
	treeId: string;
	treeName: string;
	owned: boolean;
};

export type LinkState = {
	candidates: LinkCandidate[];
	proposals: {
		id: string;
		a: string;
		b: string;
		note: string | null;
		status: "pending" | "accepted" | "rejected" | "revoked";
		canDecide: boolean;
		canRevoke: boolean;
	}[];
};
