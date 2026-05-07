export type HomeFavoriteItem = {
  id: string;
  label: string;
  subtitle?: string;
  icon: 'home' | 'briefcase' | 'hospital-box' | 'school';
  destination: string;
};

export const HOME_FAVORITE_SHORTCUTS: HomeFavoriteItem[] = [
  { id: 'home', label: 'Casa', subtitle: 'toque para editar', icon: 'home', destination: 'Casa' },
  { id: 'work', label: 'Trabalho', subtitle: 'toque para editar', icon: 'briefcase', destination: 'Trabalho' },
  { id: 'hospital', label: 'Hospital', subtitle: 'toque para editar', icon: 'hospital-box', destination: 'Hospital' },
  { id: 'school', label: 'Escola', subtitle: 'toque para editar', icon: 'school', destination: 'Escola' },
];
