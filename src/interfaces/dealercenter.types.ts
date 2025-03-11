export interface IAnswer {
  book: number;
  isBlank: null;
  addDeduct: Array<{
    action: number;
    code: string;
  }>;
  modelId?: string;
}

export interface IQuestion {
  category: string;
  type: 'checkbox' | 'select' | 'input';
  items: Array<{
    id: string;
    name: string;
  }>
  book: number;
}
