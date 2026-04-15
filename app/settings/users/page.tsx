'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Users, Plus, Pencil, Trash2, Shield, User as UserIcon,
  AlertCircle, CheckCircle, X, Eye, EyeOff, Search,
} from 'lucide-react';

interface UserRecord {
  id: string;
  username: string;
  role: string;
  provider?: string | null;
  email?: string | null;
  displayName?: string | null;
  createdAt: string;
  updatedAt?: string;
}

type ModalMode = 'create' | 'edit' | null;

export default function UsersManagementPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('USER');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setUsers(data);
    } catch {
      showToast('Không thể tải danh sách người dùng', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || session.user.role !== 'ADMIN') {
      router.push('/');
      return;
    }
    fetchUsers();
  }, [session, status, router, fetchUsers]);

  // ----- Modal helpers -----
  const openCreate = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormPassword('');
    setFormRole('USER');
    setFormError('');
    setShowPassword(false);
    setModalMode('create');
  };

  const openEdit = (u: UserRecord) => {
    setEditingUser(u);
    setFormUsername(u.username);
    setFormPassword('');
    setFormRole(u.role);
    setFormError('');
    setShowPassword(false);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingUser(null);
  };

  const handleSave = async () => {
    setFormError('');
    setFormSaving(true);

    try {
      if (modalMode === 'create') {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: formUsername, password: formPassword, role: formRole }),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Lỗi'); return; }
        showToast(`Đã tạo người dùng "${data.username}"`, 'success');
      } else if (modalMode === 'edit' && editingUser) {
        const body: Record<string, string> = { role: formRole };
        if (formUsername !== editingUser.username) body.username = formUsername;
        if (formPassword) body.password = formPassword;

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Lỗi'); return; }
        showToast(`Đã cập nhật "${data.username}"`, 'success');
      }
      closeModal();
      fetchUsers();
    } catch {
      setFormError('Lỗi kết nối máy chủ');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Lỗi xóa', 'error'); return; }
      showToast('Đã xóa người dùng', 'success');
      fetchUsers();
    } catch {
      showToast('Lỗi kết nối', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Quản lý người dùng
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Thêm, sửa, xóa tài khoản truy cập hệ thống
          </p>
        </div>
        <button onClick={openCreate} className="modern-button btn-primary gap-2 text-sm">
          <Plus className="w-4 h-4" />
          Tạo người dùng
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Tìm kiếm theo username..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-field pl-11"
        />
      </div>

      {/* Users Table */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Username</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Vai trò</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Ngày tạo</th>
                <th className="text-right px-6 py-4 font-semibold text-muted-foreground">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-muted-foreground">
                    {search ? 'Không tìm thấy kết quả' : 'Chưa có người dùng nào'}
                  </td>
                </tr>
              ) : (
                filtered.map(u => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${u.role === 'ADMIN' ? 'bg-primary/15' : 'bg-muted'}`}>
                          {u.role === 'ADMIN' ? (
                            <Shield className="w-4 h-4 text-primary" />
                          ) : u.role === 'VIEWER' ? (
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <UserIcon className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{u.username}</span>
                          {u.provider === 'oidc' && (
                            <span className="text-[10px] text-muted-foreground font-mono">SSO</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        u.role === 'ADMIN'
                          ? 'bg-primary/10 text-primary'
                          : u.role === 'VIEWER'
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {u.role === 'ADMIN' ? '🔑 Admin' : u.role === 'VIEWER' ? '👁 Viewer' : '👤 User'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Chỉnh sửa"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {session?.user?.id !== u.id && (
                          <>
                            {deletingId === u.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(u.id)}
                                  className="px-2 py-1 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:brightness-110 transition-all"
                                >
                                  Xác nhận
                                </button>
                                <button
                                  onClick={() => setDeletingId(null)}
                                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeletingId(u.id)}
                                className="p-2 rounded-xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                title="Xóa"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === 'success'
            ? 'bg-primary text-primary-foreground'
            : 'bg-destructive text-destructive-foreground'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 modern-card p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">
                {modalMode === 'create' ? 'Tạo người dùng mới' : `Chỉnh sửa: ${editingUser?.username}`}
              </h3>
              <button onClick={closeModal} className="p-2 rounded-xl hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Username</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  className="input-field"
                  placeholder="Nhập tên đăng nhập"
                />
              </div>

              {/* Hide password field for OIDC users */}
              {!(modalMode === 'edit' && editingUser?.provider === 'oidc') && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {modalMode === 'edit' ? 'Mật khẩu mới (bỏ trống = giữ nguyên)' : 'Mật khẩu'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      className="input-field pr-12"
                      placeholder={modalMode === 'edit' ? '••••••' : 'Nhập mật khẩu'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
              {modalMode === 'edit' && editingUser?.provider === 'oidc' && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-xl px-3 py-2">
                  Người dùng SSO — xác thực qua nhà cung cấp bên ngoài, không thể đặt mật khẩu.
                </p>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Vai trò</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setFormRole('VIEWER')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                      formRole === 'VIEWER'
                        ? 'border-amber-500 bg-amber-500/10 text-amber-600'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Eye className="w-4 h-4" />
                    Viewer
                  </button>
                  <button
                    onClick={() => setFormRole('USER')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                      formRole === 'USER'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <UserIcon className="w-4 h-4" />
                    User
                  </button>
                  <button
                    onClick={() => setFormRole('ADMIN')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                      formRole === 'ADMIN'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Shield className="w-4 h-4" />
                    Admin
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={closeModal} className="modern-button btn-outline text-sm">
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={formSaving || !formUsername || (modalMode === 'create' && !formPassword)}
                className="modern-button btn-primary text-sm gap-2"
              >
                {formSaving && (
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                )}
                {modalMode === 'create' ? 'Tạo' : 'Cập nhật'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
