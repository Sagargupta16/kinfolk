import { ContactWorkspace } from "@/components/contacts/ContactWorkspace";
import { NotAllowedError } from "@/lib/tree/authz";
import { contactState } from "@/lib/tree/contact-state";

export const metadata = {
	title: "Contact details -- Kinfolk",
	robots: { index: false, follow: false },
};

export default async function ContactPage({ params }: { params: Promise<{ personId: string }> }) {
	const { personId } = await params;
	try {
		return <ContactWorkspace personId={personId} initialState={await contactState(personId)} />;
	} catch (error) {
		const message =
			error instanceof NotAllowedError ? error.message : "Could not load contact details.";
		return <ContactWorkspace personId={personId} initialError={message} />;
	}
}
