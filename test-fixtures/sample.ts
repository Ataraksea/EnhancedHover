export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export interface User {
  id: number;
  name: string;
  email: string;
}

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  findById(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }

  getCount(): number {
    return this.users.length;
  }
}

const service = new UserService();
service.addUser({ id: 1, name: 'Alice', email: 'alice@example.com' });
const found = service.findById(1);
console.log(greet(found?.name ?? 'World'));
