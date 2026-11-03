// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// Compact versions preserve the information and messaging consent disclosures.
const entries = {
  en: {required: 'Required', optional: 'Optional', privacy: 'Privacy Policy', terms: 'Terms & Conditions',
    health: 'I consent to {{brand}} using my health and insurance information for medical and insurance purposes. I’m responsible for completing recommended follow-up care and assessments.',
    messaging: 'I agree to {{brand}} SMS/WhatsApp messages for annual checkups, health reminders, appointment alerts and conversational health support. Frequency varies; message/data rates may apply. Reply STOP to opt out or HELP for help. Mobile information is never shared with third parties for marketing.'},
  fr: {required: 'Obligatoire', optional: 'Facultatif', privacy: 'Confidentialité', terms: 'Conditions d’utilisation',
    health: 'J’autorise {{brand}} à utiliser mes données de santé et d’assurance à des fins médicales et d’assurance. Il m’appartient d’effectuer les soins de suivi et évaluations recommandés.',
    messaging: 'J’accepte les SMS/WhatsApp de {{brand}} pour les bilans annuels, rappels de santé, rendez-vous et assistance santé par messagerie. Fréquence variable ; frais de messages et de données possibles. Répondez STOP pour vous désinscrire, HELP pour de l’aide. Mes données mobiles ne sont jamais partagées avec des tiers à des fins marketing.'},
  es: {required: 'Obligatorio', optional: 'Opcional', privacy: 'Privacidad', terms: 'Términos de uso',
    health: 'Consiento que {{brand}} use mis datos de salud y seguro con fines médicos y de seguros. Soy responsable de completar los seguimientos y evaluaciones recomendados.',
    messaging: 'Acepto SMS/WhatsApp de {{brand}} sobre revisiones anuales, recordatorios de salud, avisos de citas y apoyo de salud por chat. Frecuencia variable; pueden aplicarse tarifas de mensajes y datos. Responde STOP para darte de baja, HELP para ayuda. Mis datos móviles nunca se comparten con terceros para marketing.'},
  de: {required: 'Erforderlich', optional: 'Optional', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen',
    health: 'Ich erlaube {{brand}}, meine Gesundheits- und Versicherungsdaten für medizinische und Versicherungszwecke zu nutzen. Empfohlene Nachbehandlungen und Untersuchungen führe ich eigenverantwortlich durch.',
    messaging: 'Ich stimme SMS/WhatsApp von {{brand}} zu Jahresuntersuchungen, Gesundheitserinnerungen, Terminhinweisen und Gesundheitsberatung per Chat zu. Häufigkeit variiert; Nachrichten- und Datengebühren sind möglich. STOP zum Abmelden, HELP für Hilfe. Meine Mobilfunkdaten werden nie für Marketing an Dritte weitergegeben.'},
  it: {required: 'Obbligatorio', optional: 'Facoltativo', privacy: 'Privacy', terms: 'Termini d’uso',
    health: 'Acconsento all’uso dei miei dati sanitari e assicurativi da parte di {{brand}} per finalità mediche e assicurative. Sono responsabile di completare le cure di controllo e valutazioni raccomandate.',
    messaging: 'Accetto SMS/WhatsApp da {{brand}} per controlli annuali, promemoria di salute, avvisi di appuntamenti e supporto sanitario in chat. Frequenza variabile; possibili costi di messaggi e dati. Rispondi STOP per annullare, HELP per aiuto. I miei dati mobili non vengono mai condivisi con terzi per marketing.'},
};
export function guestConsentCopy(locale: string) {return entries[locale.toLowerCase().slice(0, 2) as keyof typeof entries] ?? entries.en;}
