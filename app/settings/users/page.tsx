'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { RolePermissionMatrix } from '@/components/settings/RolePermissionMatrix';
import {
  Users, Plus, Pencil, Trash2, Shield, User as UserIcon,
  AlertCircle, CheckCircle, X, Search, Key
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
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('OPS');
  const [formProfileIds, setFormProfileIds] = useState<string[]>([]);
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

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/apikeys');
      const data = await res.json();
      if (data.apiKeys) {
        setAllProfiles(data.apiKeys);
      }
    } catch {
      console.error('Failed to fetch API keys');
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || session.user.role !== 'ADMIN') {
      router.push('/');
      return;
    }
    fetchUsers();
    fetchProfiles();
  }, [session, status, router, fetchUsers, fetchProfiles]);

  // ----- Modal helpers -----
  const openCreate = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormEmail('');
    setFormRole('OPS');
    setFormProfileIds([]);
    setFormError('');
    setModalMode('create');
  };

  const openEdit = async (u: UserRecord) => {
    setEditingUser(u);
    setFormUsername(u.username);
    setFormEmail(u.email ?? '');
    setFormRole(u.role);
    setFormProfileIds([]);
    setFormError('');
    setModalMode('edit');

    try {
      const res = await fetch(`/api/internal/user-profiles?userId=${u.id}`);
      const data = await res.json();
      if (data.success && data.apiKeyIds) {
        setFormProfileIds(data.apiKeyIds);
      }
    } catch {
      console.error('Failed to fetch assignments');
    }
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingUser(null);
  };

  const handleSave = async () => {
    setFormError('');
    setFormSaving(true);

    try {
      let assignedUserId = '';

      if (modalMode === 'create') {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: formUsername, email: formEmail, role: formRole }),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Lỗi'); setFormSaving(false); return; }
        assignedUserId = data.id;
        showToast(`Đã tạo người dùng "${data.username}"`, 'success');
      } else if (modalMode === 'edit' && editingUser) {
        const body: Record<string, string> = { role: formRole };
        if (formUsername !== editingUser.username) body.username = formUsername;
        if (formEmail !== (editingUser.email ?? '')) body.email = formEmail;

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Lỗi'); setFormSaving(false); return; }
        assignedUserId = editingUser.id;
        showToast(`Đã cập nhật "${data.username}"`, 'success');
      }

      // Save Profile Assignments
      if (assignedUserId) {
        await fetch('/api/internal/user-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: assignedUserId, apiKeyIds: formProfileIds })
        });
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

  const filtered = users.filter(u => {
    const needle = search.toLowerCase();
    return u.username.toLowerCase().includes(needle)
      || (u.email ?? '').toLowerCase().includes(needle);
  });

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
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        {/* paddingLeft is inline on purpose: `.input-field` is declared inside the same
            Tailwind utilities layer and emitted after `pl-*`, so its `px-4` would win
            and the text would render underneath the icon. */}
        <input
          type="text"
          placeholder="Tìm kiếm theo username hoặc email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-field"
          style={{ paddingLeft: '3rem' }}
        />
      </div>

      {/* Users Table */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Username</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Email</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Vai trò</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Ngày tạo</th>
                <th className="text-right px-6 py-4 font-semibold text-muted-foreground">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground">
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
                      {u.email
                        ? <span className="text-muted-foreground">{u.email}</span>
                        : <span className="text-muted-foreground/60 italic">chưa có</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        u.role === 'ADMIN'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {u.role === 'ADMIN' ? '🔑 Admin' : '🛠 OPS'}
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

      {/* Configurable OPS capability matrix (ADMIN-only, audited server-side) */}
      <RolePermissionMatrix onNotify={showToast} />

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
                <p className="text-[11px] text-muted-foreground">
                  Tên đăng nhập trên hệ thống SSO của tổ chức — thường là phần trước
                  dấu <span className="font-mono">@</span> của email công ty.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Email công ty
                  <span className="ml-1 font-normal text-muted-foreground">(khuyến nghị)</span>
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  className="input-field"
                  placeholder="vidu@vpbank.com.vn"
                />
                <p className="text-[11px] text-muted-foreground">
                  Điền email giúp liên kết danh tính SSO chắc chắn hơn: hệ thống khớp
                  theo email trước, rồi mới tới tên đăng nhập. Nhờ vậy người này vẫn
                  vào được kể cả khi nhà cung cấp danh tính trả về tên đăng nhập ở
                  dạng khác. Nếu ai đó không đăng nhập được, sửa email hoặc tên đăng
                  nhập tại đây cho khớp là xong.
                </p>
              </div>

              <p className="text-xs text-muted-foreground bg-muted/50 rounded-xl px-3 py-2">
                Hệ thống chỉ dùng đăng nhập SSO. Tài khoản không có mật khẩu riêng —
                xác thực do nhà cung cấp danh tính của tổ chức đảm nhiệm.
              </p>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Vai trò</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setFormRole('OPS')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                      formRole === 'OPS'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <UserIcon className="w-4 h-4" />
                    OPS
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  <strong>OPS</strong>: nhân sự vận hành — xem/thao tác Operations và Profile được phân công.
                  <strong className="ml-1">Admin</strong>: toàn quyền hệ thống. Tầng UI chỉ dành cho hai vai trò này.
                </p>
              </div>

              <div className="space-y-1.5 flex flex-col pt-3 border-t border-border">
                <label className="text-sm font-medium text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> Profile được phân công</span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{formProfileIds.length} đã chọn</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto pr-1">
                  {allProfiles.length === 0 ? (
                    <div className="col-span-2 text-xs text-muted-foreground italic text-center p-2 bg-muted/30 rounded border border-dashed">Không có profile nào trong hệ thống</div>
                  ) : (
                    allProfiles.map(p => (
                      <label key={p.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${formProfileIds.includes(p.id) ? 'bg-primary/5 border-primary/30 text-primary' : 'bg-background hover:bg-muted border-border'}`}>
                        <input
                          type="checkbox"
                          className="rounded border-border w-3.5 h-3.5"
                          checked={formProfileIds.includes(p.id)}
                          onChange={e => {
                            if (e.target.checked) setFormProfileIds(prev => [...prev, p.id]);
                            else setFormProfileIds(prev => prev.filter(id => id !== p.id));
                          }}
                        />
                        <span className="text-xs font-semibold truncate leading-tight flex-1" title={p.name}>{p.name}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Chọn các profile mà User này được phép truy cập. Các chức năng của User đó sẽ bị giới hạn chỉ hiển thị những profile được chọn. Nếu không chọn, User sẽ không quản lý profile nào. Admin thì mặc định được truy cập toàn bộ.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={closeModal} className="modern-button btn-outline text-sm">
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={formSaving || !formUsername}
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
