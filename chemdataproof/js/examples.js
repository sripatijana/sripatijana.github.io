// Example inputs for the demo buttons. The compound is 1-[4-(trifluoromethyl)phenyl]ethan-1-ol;
// the values are illustrative test data, not taken from a publication.
export const EXAMPLES = {
  clean: {
    name: '(S)-1-[4-(Trifluoromethyl)phenyl]ethan-1-ol',
    smiles: 'C[C@H](O)c1ccc(cc1)C(F)(F)F',
    text: `1H NMR (400 MHz, CDCl3) δ 7.60 (d, J = 8.1 Hz, 2H), 7.48 (d, J = 8.1 Hz, 2H), 4.96 (q, J = 6.5 Hz, 1H), 1.91 (br s, 1H), 1.50 (d, J = 6.5 Hz, 3H).
13C{1H} NMR (101 MHz, CDCl3) δ 149.7, 129.7 (q, J = 32.3 Hz), 125.7, 125.5 (q, J = 3.8 Hz), 124.2 (q, J = 272.0 Hz), 69.9, 25.4.
19F NMR (376 MHz, CDCl3) δ -62.4.
HRMS (ESI) m/z: [M+Na]+ calcd for C9H9F3NaO 213.0498; found 213.0495.`,
  },
  mistakes: {
    name: '(R)-1-[4-(Trifluoromethyl)phenyl]ethan-1-ol',
    smiles: 'C[C@H](O)c1ccc(cc1)C(F)(F)F',
    text: `1H NMR (400 MHz, CDCl3) δ 7.60 (d, J = 8.1 Hz, 2H), 7.48 (d, 2H), 4.96 (q, J = 6.5 Hz, 1H), 1.91 (s, J = 2.0 Hz, 1H), 1.50 (d, J = 6.5 Hz, 4H).
13C NMR (125 MHz, CDCl3) δ 149.7, 129.7 (q, J = 32.3 Hz), 125.7, 125.5 (q, J = 3.8 Hz), 124.2 (q, J = 272.0 Hz), 69.9, 69.9, 25.4.
HRMS (ESI) m/z: [M+Na]+ calcd for C9H9F3O 213.0498; found 213.0571.`,
  },
};
