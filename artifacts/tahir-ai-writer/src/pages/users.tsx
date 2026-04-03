import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useListUsers, useDeleteUser, useCreateUser, useUpdateUser, useResetUserPassword } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Edit, Key, Loader2 } from "lucide-react";
import { format } from "date-fns";

type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

export default function Users() {
  const { data: users = [], refetch } = useListUsers();
  const deleteMutation = useDeleteUser();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const resetPasswordMutation = useResetUserPassword();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);

  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "author" });
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "author" });
  const [newPassword, setNewPassword] = useState("");

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete user "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ id });
      refetch();
      toast({ title: "User deleted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({ data: newUser });
      toast({ title: "User created successfully" });
      setNewUser({ name: "", email: "", password: "", role: "author" });
      setCreateOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({ name: u.name, email: u.email, role: u.role });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editUser) return;
    try {
      await updateMutation.mutateAsync({ id: editUser.id, data: editForm });
      toast({ title: "User updated" });
      setEditOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const openReset = (u: User) => {
    setResetUser(u);
    setNewPassword("");
    setResetOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetUser || !newPassword) {
      toast({ title: "Enter a new password", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    try {
      await resetPasswordMutation.mutateAsync({ id: resetUser.id, data: { newPassword } });
      toast({ title: `Password reset for ${resetUser.name}` });
      setResetOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <h1 className="text-2xl font-bold">User Management</h1>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create User
          </Button>
        </div>

        <div className="bg-white dark:bg-zinc-900 border rounded-md shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-700 dark:text-gray-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{user.name}</td>
                    <td className="px-4 py-3 text-gray-500">{user.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={user.role === "admin" ? "default" : "secondary"} className={user.role === "admin" ? "bg-primary text-white" : ""}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(new Date(user.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <Button
                        variant="outline" size="icon" className="h-8 w-8"
                        title="Reset Password"
                        onClick={() => openReset(user as User)}
                      >
                        <Key className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline" size="icon" className="h-8 w-8"
                        title="Edit"
                        onClick={() => openEdit(user as User)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline" size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete"
                        onClick={() => handleDelete(user.id, user.name)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">No users found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input placeholder="John Doe" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="john@example.com" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="Min 6 characters" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={newUser.role}
                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
              >
                <option value="author">Author</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={editForm.role}
                onChange={e => setEditForm({ ...editForm, role: e.target.value })}
              >
                <option value="author">Author</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-500">Set a new password for <strong>{resetUser?.name}</strong>.</p>
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleResetPassword()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetPasswordMutation.isPending}>
              {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
