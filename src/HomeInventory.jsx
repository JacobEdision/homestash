
import { useState, useMemo, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
// These values come from your Vercel environment variables.
// You set them in Vercel → Project → Settings → Environment Variables.
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
// Map snake_case Supabase columns → camelCase used in the UI
function mapUser(u)  { return { ...u, houseId: u.house_id, loginCount: u.login_count, lastLogin: u.last_login }; }
function mapRoom(r)  { return { ...r, houseId: r.house_id }; }
function mapStorage(s) { return { ...s, roomId: s.room_id }; }
function mapContainer(c) { return { ...c, storageId: c.storage_id }; }
function mapItem(i)  {
  return {
    ...i,
    storageId:   i.storage_id,
    containerId: i.container_id || null,
    roomId:      i.room_id,
    tagIds:      Array.isArray(i.tag_ids)  ? i.tag_ids  : [],
    perishable:  Boolean(i.perishable),
    borrower:    i.borrower || null,
  };
}
function mapMoveLog(l) {
  return { ...l, itemId: l.item_id, fromRoom: l.from_room, toRoom: l.to_room, userId: l.user_id };
}
function mapLendLog(l) {
  return { ...l, itemId: l.item_id, userId: l.user_id, returned: Boolean(l.returned) };
}
function mapGroup(g) {
  return { ...g, roomIds: Array.isArray(g.room_ids) ? g.room_ids : [] };
}
function mapGuestPerm(p) { return { userId: p.user_id, roomId: p.room_id }; }

// Map camelCase UI → snake_case for Supabase upsert
function itemToDb(i) {
  return {
    id: i.id, name: i.name,
    storage_id: i.storageId, container_id: i.containerId || null,
    room_id: i.roomId, qty: i.qty, unit: i.unit,
    perishable: i.perishable,
    tag_ids: i.tagIds, status: i.status, borrower: i.borrower || null
  };
}
function groupToDb(g) {
  return { id: g.id, name: g.name, room_ids: g.roomIds, cols: g.cols };
}

// ─── DB OPERATIONS ────────────────────────────────────────────────────────────
const db = {
  // Load all rows from a table
  getAll: async (table) => {
    const { data, error } = await supabase.from(table).select("*");
    if (error) { console.error(`Error loading ${table}:`, error); return []; }
    return data || [];
  },
  // Insert or update a row (upsert)
  upsert: async (table, row) => {
    const { error } = await supabase.from(table).upsert(row);
    if (error) console.error(`Error saving to ${table}:`, error);
  },
  // Insert a new row
  insert: async (table, row) => {
    const { error } = await supabase.from(table).insert(row);
    if (error) console.error(`Error inserting into ${table}:`, error);
  },
  // Update specific fields on a row by id
  update: async (table, id, fields) => {
    const { error } = await supabase.from(table).update(fields).eq("id", id);
    if (error) console.error(`Error updating ${table}:`, error);
  },
  // Delete a row by id
  delete: async (table, id) => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) console.error(`Error deleting from ${table}:`, error);
  },
};

const ROLE_COLORS = {
  superadmin: { bg: "#EEEDFE", fg: "#3C3489" },
  admin: { bg: "#E6F1FB", fg: "#0C447C" },
  subadmin: { bg: "#EAF3DE", fg: "#27500A" },
  regular: { bg: "#F1EFE8", fg: "#444441" },
  guest: { bg: "#FAEEDA", fg: "#633806" },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");

export default function App() {
  // ── All state starts empty and is loaded from the server ──
  const [users,      setUsers]      = useState([]);
  const [houses,     setHouses]     = useState([]);
  const [tags,       setTags]       = useState([]);
  const [roomGroups, setRoomGroups] = useState([]);
  const [rooms,      setRooms]      = useState([]);
  const [storages,   setStorages]   = useState([]);
  const [containers, setContainers] = useState([]);
  const [items,      setItems]      = useState([]);
  const [moveLogs,   setMoveLogs]   = useState([]);
  const [lendLogs,   setLendLogs]   = useState([]);
  const [guestPerms, setGuestPerms] = useState([]);
  const [loading,    setLoading]    = useState(true);

  const [currentUserId, setCurrentUserId] = useState("alice");
  const [view,          setView]          = useState("home");
  const [roomId,        setRoomId]        = useState(null);
  const [filterPerishable, setFilterPerishable] = useState(null);
  const [search,        setSearch]        = useState("");
  const [modal,         setModal]         = useState(null);
  const [toast,         setToast]         = useState(null);

  // ── Load everything from Supabase on first render ──
  useEffect(() => {
    Promise.all([
      db.getAll("users").then(d => setUsers(d.map(mapUser))),
      db.getAll("houses").then(d => setHouses(d)),
      db.getAll("tags").then(d => setTags(d)),
      db.getAll("room_groups").then(d => setRoomGroups(d.map(mapGroup))),
      db.getAll("rooms").then(d => setRooms(d.map(mapRoom))),
      db.getAll("storages").then(d => setStorages(d.map(mapStorage))),
      db.getAll("containers").then(d => setContainers(d.map(mapContainer))),
      db.getAll("items").then(d => setItems(d.map(mapItem))),
      db.getAll("move_logs").then(d => setMoveLogs(d.map(mapMoveLog))),
      db.getAll("lend_logs").then(d => setLendLogs(d.map(mapLendLog))),
      db.getAll("guest_permissions").then(d => setGuestPerms(d.map(mapGuestPerm))),
    ]).then(() => setLoading(false))
      .catch(e => { console.error("Load error:", e); setLoading(false); });
  }, []);

  const currentUser = users.find(u => u.id === currentUserId) || { id:"alice", name:"Loading…", role:"regular" };
  const canEdit = ["admin", "subadmin"].includes(currentUser.role);
  const canAdmin = currentUser.role === "admin";
  const isSuperAdmin = currentUser.role === "superadmin";

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const visibleRooms = useMemo(() => {
    if (currentUser.role === "guest") {
      const allowed = guestPerms.filter(p => p.userId === currentUser.id).map(p => p.roomId);
      return rooms.filter(r => allowed.includes(r.id));
    }
    return rooms.filter(r => r.houseId === "h1");
  }, [currentUser, guestPerms, rooms]);

  const filteredItems = useCallback((list) => {
    let r = list;
    if (filterPerishable !== null) r = r.filter(i => i.perishable === filterPerishable);
    if (search) r = r.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [filterPerishable, search]);

  const cycleUser = () => {
    const idx = users.findIndex(u => u.id === currentUserId);
    const next = users[(idx + 1) % users.length];
    setCurrentUserId(next.id);
    if (next.role === "superadmin") setView("superadmin");
    else if (view === "superadmin") setView("home");
    showToast(`Switched to ${next.name} (${next.role})`);
  };

  const nav = (v, rid = null) => {
    setView(v);
    if (rid) setRoomId(rid);
    setSearch("");
  };

  // ── Item mutations ──
  const addItem = async (data) => {
    const newItem = { id: "i" + uid(), ...data, status: "normal", borrower: null };
    await db.upsert("items", itemToDb(newItem));
    setItems(p => [...p, newItem]);
    showToast("Item added!");
  };
  const editItem = async (id, data) => {
    const updated = { ...items.find(i => i.id === id), ...data };
    await db.upsert("items", itemToDb(updated));
    setItems(p => p.map(i => i.id === id ? updated : i));
    showToast("Item updated");
  };
  const deleteItem = async (id) => {
    await db.delete("items", id);
    setItems(p => p.filter(i => i.id !== id));
    showToast("Item deleted");
  };
  const moveItem = async (id, newRoom, newStorage, newContainer, reason) => {
    const item = items.find(i => i.id === id);
    const log = { id: "ml" + uid(), item_id: id, from_room: item.roomId, to_room: newRoom, reason, user_id: currentUserId, ts: now() };
    await db.insert("move_logs", log);
    const updated = { ...item, roomId: newRoom, storageId: newStorage, containerId: newContainer };
    await db.upsert("items", itemToDb(updated));
    setMoveLogs(p => [...p, mapMoveLog(log)]);
    setItems(p => p.map(i => i.id === id ? updated : i));
    showToast("Item moved!");
  };
  const lendItem = async (id, borrower, qty) => {
    const item = items.find(i => i.id === id);
    const log = { id: "ll" + uid(), item_id: id, borrower, qty, user_id: currentUserId, ts: now(), returned: false };
    await db.insert("lend_logs", log);
    const updated = { ...item, status: "lent", borrower, qty: item.perishable ? item.qty - qty : item.qty };
    await db.upsert("items", itemToDb(updated));
    setLendLogs(p => [...p, mapLendLog(log)]);
    setItems(p => p.map(i => i.id === id ? updated : i));
    showToast("Item lent to " + borrower);
  };
  const returnItem = async (id) => {
    const log = lendLogs.find(l => l.itemId === id && !l.returned);
    const item = items.find(i => i.id === id);
    if (log) await db.update("lend_logs", log.id, { returned: true });
    const backQty = (item.perishable && log) ? item.qty + log.qty : item.qty;
    const updated = { ...item, status: "normal", borrower: null, qty: backQty };
    await db.upsert("items", itemToDb(updated));
    if (log) setLendLogs(p => p.map(l => l.id === log.id ? { ...l, returned: true } : l));
    setItems(p => p.map(i => i.id === id ? updated : i));
    showToast("Item returned");
  };

  // ── Tag mutations ──
  const addTag = async (t) => {
    const newTag = { id: "t" + uid(), ...t };
    await db.upsert("tags", newTag);
    setTags(p => [...p, newTag]);
    showToast("Tag added");
  };
  const editTag = async (id, t) => {
    const updated = { ...tags.find(x => x.id === id), ...t };
    await db.upsert("tags", updated);
    setTags(p => p.map(x => x.id === id ? updated : x));
    showToast("Tag updated");
  };
  const deleteTag = async (id) => {
    await db.delete("tags", id);
    setTags(p => p.filter(x => x.id !== id));
    setItems(p => p.map(i => ({ ...i, tagIds: i.tagIds.filter(t => t !== id) })));
    showToast("Tag deleted");
  };

  // ── User mutations ──
  const changeRole = async (id, role) => {
    const u = users.find(x => x.id === id);
    const updated = { ...u, role };
    await db.update("users", id, { role });
    setUsers(p => p.map(x => x.id === id ? updated : x));
    showToast("Role updated");
  };

  // ── Group mutations ──
  const addGroup = async (g) => {
    const newGroup = { id: "g" + uid(), ...g, roomIds: [] };
    await db.upsert("room_groups", groupToDb(newGroup));
    setRoomGroups(p => [...p, newGroup]);
  };
  const deleteGroup = async (id) => {
    await db.delete("room_groups", id);
    setRoomGroups(p => p.filter(g => g.id !== id));
  };
  const toggleGroupRoom = async (gid, rid, checked) => {
    if (checked) {
      const alreadyInGroup = roomGroups.find(g => g.id !== gid && g.roomIds.includes(rid));
      if (alreadyInGroup) {
        showToast(`"${rooms.find(r => r.id === rid)?.name}" is already in "${alreadyInGroup.name}". Remove it there first.`);
        return;
      }
    }
    const updated = roomGroups.map(g => g.id !== gid ? g : { ...g, roomIds: checked ? [...g.roomIds, rid] : g.roomIds.filter(x => x !== rid) });
    const group = updated.find(g => g.id === gid);
    await db.upsert("room_groups", groupToDb(group));
    setRoomGroups(updated);
  };
  const setGroupCols = async (gid, cols) => {
    const updated = roomGroups.map(g => g.id !== gid ? g : { ...g, cols });
    const group = updated.find(g => g.id === gid);
    await db.upsert("room_groups", groupToDb(group));
    setRoomGroups(updated);
  };

  // ── Export CSV ──
  const exportCSV = () => {
    const rows = items.map(i => {
      const room = rooms.find(r => r.id === i.roomId);
      const house = room ? houses.find(h => h.id === room.houseId) : null;
      const storage = storages.find(s => s.id === i.storageId);
      const container = i.containerId ? containers.find(c => c.id === i.containerId) : null;
      return [house?.name, room?.name, storage?.name, container?.name || "", i.name, i.qty, i.unit, i.perishable ? "Yes" : "No", i.status, i.borrower || "", i.tagIds.map(tid => tags.find(t => t.id === tid)?.name).filter(Boolean).join(";")].map(v => `"${v}"`).join(",");
    });
    const csv = ["House,Room,Storage,Container,Item,Qty,Unit,Perishable,Status,Borrower,Tags", ...rows].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "inventory.csv"; a.click();
    showToast("CSV exported!");
  };

  // ── Loading screen ──
  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"system-ui,sans-serif", flexDirection:"column", gap:12 }}>
        <div style={{ fontSize:32 }}>🏠</div>
        <div style={{ fontSize:16, fontWeight:500 }}>HomeStash</div>
        <div style={{ fontSize:13, color:"#888" }}>Loading data from database…</div>
      </div>
    );
  }

  // ── RENDER ──
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "system-ui,sans-serif", fontSize: 14 }}>
      <Sidebar view={view} nav={nav} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} currentUser={currentUser} lendLogs={lendLogs} filterPerishable={filterPerishable} setFilterPerishable={setFilterPerishable} exportCSV={exportCSV} cycleUser={cycleUser} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Header search={search} setSearch={setSearch} currentUser={currentUser} cycleUser={cycleUser} canEdit={canEdit} openAddItem={() => setModal({ type: "addItem" })} />
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {view === "home" && <HomeView rooms={visibleRooms} roomGroups={roomGroups} canAdmin={canAdmin} nav={nav} items={items} tags={tags} storages={storages} search={search} filteredItems={filteredItems} />}
          {view === "room" && <RoomView roomId={roomId} rooms={rooms} storages={storages} containers={containers} items={items} tags={tags} canEdit={canEdit} canAdmin={canAdmin} filterPerishable={filterPerishable} setFilterPerishable={setFilterPerishable} filteredItems={filteredItems} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} nav={nav} />}
          {view === "allitems" && <AllItemsView items={filteredItems(items)} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} filterPerishable={filterPerishable} setFilterPerishable={setFilterPerishable} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} />}
          {view === "lentout" && <LentOutView items={items} lendLogs={lendLogs} rooms={rooms} returnItem={returnItem} />}
          {view === "auditlog" && <AuditLogView moveLogs={moveLogs} items={items} rooms={rooms} />}
          {view === "tags" && <TagsView tags={tags} canAdmin={canAdmin} setModal={setModal} deleteTag={deleteTag} />}
          {view === "users" && <UsersView users={users} currentUserId={currentUserId} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} houses={houses} changeRole={changeRole} />}
          {view === "groups" && <GroupsView roomGroups={roomGroups} rooms={visibleRooms} canAdmin={canAdmin} addGroup={addGroup} deleteGroup={deleteGroup} toggleGroupRoom={toggleGroupRoom} setGroupCols={setGroupCols} showToast={showToast} allRooms={rooms} />}
          {view === "superadmin" && <SuperAdminView users={users} houses={houses} rooms={rooms} items={items} storages={storages} containers={containers} moveLogs={moveLogs} lendLogs={lendLogs} isSuperAdmin={isSuperAdmin} />}
        </div>
      </div>
      {modal && <Modal modal={modal} setModal={setModal} rooms={rooms} storages={storages} containers={containers} tags={tags} items={items} addItem={addItem} editItem={editItem} moveItem={moveItem} lendItem={lendItem} addTag={addTag} editTag={editTag} visibleRooms={visibleRooms} showToast={showToast} />}
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#fff", border: "0.5px solid #ddd", borderRadius: 8, padding: "8px 18px", fontSize: 13, zIndex: 9999, boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>{toast}</div>}
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function Sidebar({ view, nav, canAdmin, isSuperAdmin, currentUser, lendLogs, filterPerishable, setFilterPerishable, exportCSV, cycleUser }) {
  const lentCount = lendLogs.filter(l => !l.returned).length;
  const rc = ROLE_COLORS[currentUser.role] || ROLE_COLORS.regular;
  const SBItem = ({ v, icon, label, badge, sub }) => (
    <div onClick={() => nav(v)} style={{ display: "flex", alignItems: "center", gap: 8, padding: sub ? "6px 16px 6px 32px" : "7px 16px", cursor: "pointer", fontSize: 13, color: view === v ? "#111" : "#666", fontWeight: view === v ? 500 : 400, background: view === v ? "#f4f4f2" : "transparent" }}>
      <span style={{ fontSize: 14, width: 16, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge !== undefined && <span style={{ background: "#E6F1FB", color: "#0C447C", fontSize: 10, padding: "1px 6px", borderRadius: 10 }}>{badge}</span>}
    </div>
  );

  // SuperAdmin only sees Statistics + Users
  if (isSuperAdmin) {
    return (
      <div style={{ width: 220, background: "#fff", borderRight: "0.5px solid #e5e5e5", display: "flex", flexDirection: "column", overflowY: "auto", flexShrink: 0 }}>
        <div style={{ padding: "14px 16px 10px", fontWeight: 500, fontSize: 15, borderBottom: "0.5px solid #e5e5e5" }}>🏠 HomeStash</div>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: ".07em", marginTop: 4 }}>Super Admin</div>
        <SBItem v="superadmin" icon="📊" label="Statistics" />
        <SBItem v="users" icon="👥" label="Users" />
        <div style={{ marginTop: "auto", padding: "12px 16px", borderTop: "0.5px solid #e5e5e5", display: "flex", alignItems: "center", gap: 8 }}>
          <div onClick={cycleUser} style={{ width: 28, height: 28, borderRadius: "50%", background: "#EEEDFE", color: "#3C3489", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, cursor: "pointer", flexShrink: 0 }} title="Click to switch user">{currentUser.name.slice(0, 2).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{currentUser.name}</div>
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: rc.bg, color: rc.fg, fontWeight: 500 }}>{currentUser.role}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ width: 220, background: "#fff", borderRight: "0.5px solid #e5e5e5", display: "flex", flexDirection: "column", overflowY: "auto", flexShrink: 0 }}>
      <div style={{ padding: "14px 16px 10px", fontWeight: 500, fontSize: 15, borderBottom: "0.5px solid #e5e5e5" }}>🏠 HomeStash</div>
      <SBItem v="home" icon="🏠" label="Rooms" />
      <SBItem v="allitems" icon="📦" label="All Items" />
      <div style={{ padding: "3px 16px 3px 32px", fontSize: 11, color: "#999" }}>Filter by type</div>
      <div onClick={() => { setFilterPerishable(null); nav("allitems"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 16px 5px 32px", cursor: "pointer", fontSize: 12, color: filterPerishable === null ? "#111" : "#666" }}>· All</div>
      <div onClick={() => { setFilterPerishable(true); nav("allitems"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 16px 5px 32px", cursor: "pointer", fontSize: 12, color: filterPerishable === true ? "#111" : "#666" }}>🥬 Perishable</div>
      <div onClick={() => { setFilterPerishable(false); nav("allitems"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 16px 5px 32px", cursor: "pointer", fontSize: 12, color: filterPerishable === false ? "#111" : "#666" }}>🔩 Non-Perishable</div>
      <SBItem v="lentout" icon="🤝" label="Lent Out" badge={lentCount} />
      <SBItem v="auditlog" icon="📋" label="Audit Log" />
      {canAdmin && <>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: ".07em", marginTop: 8 }}>Admin</div>
        <SBItem v="tags" icon="🏷️" label="Manage Tags" />
        <SBItem v="users" icon="👥" label="Users" />
        <SBItem v="groups" icon="🗂️" label="Room Groups" />
        <div onClick={exportCSV} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, color: "#666" }}><span style={{ fontSize: 14, width: 16 }}>⬇️</span> Export CSV</div>
      </>}
      {isSuperAdmin && <>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: ".07em", marginTop: 8 }}>Super Admin</div>
        <SBItem v="superadmin" icon="📊" label="Statistics" />
      </>}
      <div style={{ marginTop: "auto", padding: "12px 16px", borderTop: "0.5px solid #e5e5e5", display: "flex", alignItems: "center", gap: 8 }}>
        <div onClick={cycleUser} style={{ width: 28, height: 28, borderRadius: "50%", background: "#E6F1FB", color: "#0C447C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, cursor: "pointer", flexShrink: 0 }} title="Click to switch user">{currentUser.name.slice(0, 2).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: rc.bg, color: rc.fg, fontWeight: 500 }}>{currentUser.role}</span>
        </div>
      </div>
    </div>
  );
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function Header({ search, setSearch, cycleUser, canEdit, openAddItem }) {
  return (
    <div style={{ height: 48, background: "#fff", borderBottom: "0.5px solid #e5e5e5", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0 }}>
      <div style={{ position: "relative", width: 380 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items, rooms, tags…" style={{ width: "100%", height: 32, border: "0.5px solid #ccc", borderRadius: 8, padding: "0 32px 0 10px", fontSize: 13, background: "#f9f9f8" }} />
        {search && <span onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#888", fontSize: 15, lineHeight: 1 }}>✕</span>}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {canEdit && <Btn primary onClick={openAddItem}>+ Add Item</Btn>}
      </div>
    </div>
  );
}

// ─── FILTER PILLS ────────────────────────────────────────────────────────────
function FilterPills({ filterPerishable, setFilterPerishable }) {
  const Pill = ({ val, label }) => (
    <span onClick={() => setFilterPerishable(val)} style={{ padding: "4px 10px", border: "0.5px solid #ccc", borderRadius: 20, fontSize: 12, cursor: "pointer", background: filterPerishable === val ? "#111" : "#f4f4f2", color: filterPerishable === val ? "#fff" : "#555" }}>{label}</span>
  );
  return <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}><Pill val={null} label="All" /><Pill val={true} label="🥬 Perishable" /><Pill val={false} label="🔩 Non-Perishable" /></div>;
}

// ─── HOME VIEW ───────────────────────────────────────────────────────────────
function HomeView({ rooms, roomGroups, canAdmin, nav, items, tags, storages, search, filteredItems }) {
  if (search) {
    const found = filteredItems(items);
    return <div><div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Search Results</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>{found.map(i => <ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={[]} compact />)}</div></div>;
  }
  const groupedIds = roomGroups.flatMap(g => g.roomIds);
  const ungrouped = rooms.filter(r => !groupedIds.includes(r.id));
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Rooms</div>
      {roomGroups.map(g => {
        const gRooms = rooms.filter(r => g.roomIds.includes(r.id));
        if (!gRooms.length) return null;
        return (
          <div key={g.id} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#888", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              {g.name}
              {canAdmin && <span onClick={() => nav("groups")} style={{ cursor: "pointer", fontSize: 11, color: "#aaa" }}>[edit]</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols},1fr)`, gap: 10 }}>
              {gRooms.map(r => <RoomCard key={r.id} room={r} items={items.filter(i => i.roomId === r.id)} storages={storages.filter(s => s.roomId === r.id)} tags={tags} nav={nav} />)}
            </div>
          </div>
        );
      })}
      {ungrouped.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#888", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Other Rooms</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {ungrouped.map(r => <RoomCard key={r.id} room={r} items={items.filter(i => i.roomId === r.id)} storages={storages.filter(s => s.roomId === r.id)} tags={tags} nav={nav} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, items, storages, tags, nav }) {
  const uniqueTagIds = [...new Set(items.flatMap(i => i.tagIds))].slice(0, 4);
  return (
    <div onClick={() => nav("room", room.id)} style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12, padding: 14, cursor: "pointer", transition: "border-color .15s" }} onMouseEnter={e => e.currentTarget.style.borderColor = "#aaa"} onMouseLeave={e => e.currentTarget.style.borderColor = "#e5e5e5"}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{room.icon} {room.name}</div>
      <div style={{ fontSize: 12, color: "#888" }}>{items.length} items · {storages.length} storage units</div>
      {uniqueTagIds.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>{uniqueTagIds.map(tid => { const t = tags.find(x => x.id === tid); return t ? <span key={tid} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: t.bg, color: t.fg }}>{t.name}</span> : null; })}</div>}
    </div>
  );
}

// ─── ROOM VIEW ───────────────────────────────────────────────────────────────
function RoomView({ roomId, rooms, storages, containers, items, tags, canEdit, canAdmin, filterPerishable, setFilterPerishable, filteredItems, setModal, deleteItem, returnItem, nav }) {
  const [collapsed, setCollapsed] = useState({});
  const room = rooms.find(r => r.id === roomId);
  if (!room) return <div style={{ color: "#888", textAlign: "center", padding: 32 }}>Room not found</div>;
  const roomStorages = storages.filter(s => s.roomId === roomId);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span onClick={() => nav("home")} style={{ cursor: "pointer", color: "#888", fontSize: 13 }}>← Rooms</span>
        <span style={{ color: "#bbb" }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{room.icon} {room.name}</span>
      </div>
      <FilterPills filterPerishable={filterPerishable} setFilterPerishable={setFilterPerishable} />
      {roomStorages.map(s => {
        const sContainers = containers.filter(c => c.storageId === s.id);
        const directItems = filteredItems(items.filter(i => i.storageId === s.id && !i.containerId));
        const isCollapsed = collapsed[s.id];
        return (
          <div key={s.id} style={{ marginBottom: 16 }}>
            <div onClick={() => setCollapsed(p => ({ ...p, [s.id]: !p[s.id] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f9f9f8", border: "0.5px solid #e5e5e5", borderRadius: 8, cursor: "pointer", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>🗄️ {s.name}</span>
              {canEdit && <span onClick={e => { e.stopPropagation(); setModal({ type: "addItem", preRoom: roomId, preStorage: s.id, preContainer: null }); }} style={{ fontSize: 11, padding: "3px 8px", border: "0.5px solid #ccc", borderRadius: 6, cursor: "pointer", background: "#fff" }}>+ Add Item</span>}
              <span style={{ fontSize: 11, color: "#888" }}>{isCollapsed ? "▸" : "▾"}</span>
            </div>
            {!isCollapsed && <>
              {sContainers.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                  {sContainers.map(c => {
                    const cnt = filteredItems(items.filter(i => i.containerId === c.id)).length;
                    return (
                      <div key={c.id} style={{ border: "0.5px solid #e5e5e5", borderRadius: 8, padding: "8px 10px", background: "#fff", cursor: "pointer" }} onClick={() => setModal({ type: "container", container: c, storage: s, room })}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>📁 {c.name}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{cnt} items</div>
                        {canEdit && <span onClick={e => { e.stopPropagation(); setModal({ type: "addItem", preRoom: roomId, preStorage: s.id, preContainer: c.id }); }} style={{ display: "inline-block", marginTop: 6, fontSize: 11, padding: "2px 7px", border: "0.5px solid #ccc", borderRadius: 5, cursor: "pointer", background: "#f9f9f8" }}>+ Add</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {directItems.length > 0 && <>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Direct items (no container):</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
                  {directItems.map(i => <ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} />)}
                </div>
              </>}
            </>}
          </div>
        );
      })}
    </div>
  );
}

// ─── ALL ITEMS ────────────────────────────────────────────────────────────────
function AllItemsView({ items, tags, rooms, storages, containers, canEdit, canAdmin, filterPerishable, setFilterPerishable, setModal, deleteItem, returnItem }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>All Items</div>
      <FilterPills filterPerishable={filterPerishable} setFilterPerishable={setFilterPerishable} />
      {!items.length ? <div style={{ color: "#888", textAlign: "center", padding: 32 }}>No items found</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
          {items.map(i => <ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} />)}
        </div>}
    </div>
  );
}

// ─── ITEM CARD ───────────────────────────────────────────────────────────────
function ItemCard({ item, tags, rooms, storages, containers, canEdit, canAdmin, setModal, deleteItem, returnItem, compact }) {
  const oos = item.qty === 0;
  const lent = item.status === "lent";
  const room = rooms.find(r => r.id === item.roomId);
  const storage = storages.find(s => s.id === item.storageId);
  const container = item.containerId ? containers.find(c => c.id === item.containerId) : null;
  return (
    <div style={{ background: oos ? "#f9f9f8" : "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12, padding: 12, position: "relative", opacity: oos ? .6 : 1 }}>
      {oos && <span style={{ position: "absolute", top: 10, right: 10, background: "#F7C1C1", color: "#791F1F", fontSize: 10, padding: "2px 6px", borderRadius: 10 }}>Out of Stock</span>}
      {lent && <span style={{ position: "absolute", top: 10, right: 10, background: "#FAC775", color: "#412402", fontSize: 10, padding: "2px 6px", borderRadius: 10 }}>Lent: {item.borrower}</span>}
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3, paddingRight: lent || oos ? 70 : 0 }}>{item.name}</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{room?.name} › {storage?.name}{container ? " › " + container.name : ""}</div>
      <div style={{ fontSize: 12, color: "#666" }}>Qty: {item.qty} {item.unit} {item.perishable ? "🥬" : ""}</div>
      {item.tagIds.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>{item.tagIds.map(tid => { const t = tags.find(x => x.id === tid); return t ? <span key={tid} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: t.bg, color: t.fg }}>{t.name}</span> : null; })}</div>}
      {!compact && (canEdit || canAdmin) && (
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          {canEdit && <ActBtn onClick={() => setModal({ type: "move", item })}>Move</ActBtn>}
          {canEdit && !lent && <ActBtn onClick={() => setModal({ type: "lend", item })}>Lend</ActBtn>}
          {lent && <ActBtn onClick={() => returnItem(item.id)}>Return</ActBtn>}
          {canEdit && <ActBtn onClick={() => setModal({ type: "editItem", item })}>Edit</ActBtn>}
          {canAdmin && <ActBtn danger onClick={() => deleteItem(item.id)}>Del</ActBtn>}
        </div>
      )}
    </div>
  );
}

// ─── LENT OUT ────────────────────────────────────────────────────────────────
function LentOutView({ items, lendLogs, rooms, returnItem }) {
  const active = lendLogs.filter(l => !l.returned);
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Lent Out Items</div>
      {!active.length ? <div style={{ color: "#888", textAlign: "center", padding: 32 }}>No items currently lent out</div> :
        <div style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12 }}>
          {active.map(l => {
            const item = items.find(i => i.id === l.itemId);
            const room = item ? rooms.find(r => r.id === item.roomId) : null;
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "0.5px solid #f0f0ee" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{item?.name}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>Borrower: <strong>{l.borrower}</strong> · Qty: {l.qty} · {room?.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{l.ts} · by {l.userId}</div>
                </div>
                <Btn onClick={() => returnItem(item.id)}>Return</Btn>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── AUDIT LOG ───────────────────────────────────────────────────────────────
function AuditLogView({ moveLogs, items, rooms }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Audit / Move Log</div>
      {!moveLogs.length ? <div style={{ color: "#888", textAlign: "center", padding: 32 }}>No logs yet</div> :
        <div style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12 }}>
          {[...moveLogs].reverse().map(l => {
            const item = items.find(i => i.id === l.itemId);
            const fromRoom = rooms.find(r => r.id === l.fromRoom);
            const toRoom = rooms.find(r => r.id === l.toRoom);
            return (
              <div key={l.id} style={{ padding: "8px 14px", borderBottom: "0.5px solid #f0f0ee", fontSize: 12 }}>
                <div><strong>{item?.name || "Unknown"}</strong> moved from <em>{fromRoom?.name || "?"}</em> → <em>{toRoom?.name || "?"}</em></div>
                <div style={{ color: "#666" }}>Reason: {l.reason} · By: {l.userId}</div>
                <div style={{ color: "#aaa", fontSize: 11 }}>{l.ts}</div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── TAGS VIEW ───────────────────────────────────────────────────────────────
function TagsView({ tags, canAdmin, setModal, deleteTag }) {
  if (!canAdmin) return <div style={{ color: "#888", textAlign: "center", padding: 32 }}>Admin only</div>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 500 }}>Manage Tags</div>
        <Btn primary onClick={() => setModal({ type: "addTag" })}>+ Add Tag</Btn>
      </div>
      <div style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12 }}>
        {tags.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "0.5px solid #f0f0ee" }}>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: t.bg, color: t.fg }}>{t.name}</span>
            <span style={{ flex: 1 }} />
            <ActBtn onClick={() => setModal({ type: "editTag", tag: t })}>Edit</ActBtn>
            <ActBtn danger onClick={() => deleteTag(t.id)}>Delete</ActBtn>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── USERS VIEW ──────────────────────────────────────────────────────────────
function UsersView({ users, currentUserId, canAdmin, isSuperAdmin, houses, changeRole }) {
  if (!canAdmin && !isSuperAdmin) return <div style={{ color: "#888", textAlign: "center", padding: 32 }}>Access denied</div>;

  const UserTable = ({ userList, editable }) => (
    <div style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9f9f8" }}>
            {["Name", "Role", "Logins", "Last Login", ...(editable ? ["Change Role"] : [])].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 500, borderBottom: "0.5px solid #e5e5e5", color: "#666" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {userList.map(u => {
            const rc = ROLE_COLORS[u.role] || ROLE_COLORS.regular;
            return (
              <tr key={u.id} style={{ borderBottom: "0.5px solid #f0f0ee" }}>
                <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                  {u.name} {u.id === currentUserId ? <span style={{ fontSize: 10, color: "#888" }}>(you)</span> : ""}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: rc.bg, color: rc.fg, fontWeight: 500 }}>{u.role}</span>
                </td>
                <td style={{ padding: "8px 12px", color: "#666" }}>{u.loginCount}</td>
                <td style={{ padding: "8px 12px", color: "#888" }}>{u.lastLogin}</td>
                {editable && (
                  <td style={{ padding: "8px 12px" }}>
                    {u.id !== currentUserId && (
                      <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} style={{ fontSize: 12, padding: "2px 6px", height: 28, border: "0.5px solid #ccc", borderRadius: 6 }}>
                        {["admin", "subadmin", "regular", "guest"].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── SuperAdmin view: all users grouped by house ──
  if (isSuperAdmin) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>All Users</div>
        {houses.map(house => {
          const houseUsers = users.filter(u => u.houseId === house.id);
          if (!houseUsers.length) return null;
          return (
            <div key={house.id} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#888", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                🏠 {house.name}
                <span style={{ background: "#f4f4f2", color: "#666", fontSize: 11, padding: "1px 7px", borderRadius: 10, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{houseUsers.length} users</span>
              </div>
              <UserTable userList={houseUsers} editable={false} />
            </div>
          );
        })}
        {/* Users with no house */}
        {users.filter(u => !u.houseId || !houses.find(h => h.id === u.houseId)).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#888", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>No House Assigned</div>
            <UserTable userList={users.filter(u => !u.houseId || !houses.find(h => h.id === u.houseId))} editable={false} />
          </div>
        )}
      </div>
    );
  }

  // ── Admin view: all users in their house except superadmin, with role editing ──
  const visibleUsers = users.filter(u => u.role !== "superadmin");
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Users</div>
      <UserTable userList={visibleUsers} editable={true} />
    </div>
  );
}

// ─── GROUPS VIEW ─────────────────────────────────────────────────────────────
function GroupsView({ roomGroups, rooms, canAdmin, addGroup, deleteGroup, toggleGroupRoom, setGroupCols, showToast, allRooms }) {
  const [newName, setNewName] = useState("");
  if (!canAdmin) return <div style={{ color: "#888", textAlign: "center", padding: 32 }}>Admin only</div>;
  const roomsToShow = allRooms || rooms;
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Room Groups</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New group name" style={{ height: 32, border: "0.5px solid #ccc", borderRadius: 8, padding: "0 10px", fontSize: 13, flex: 1 }} />
        <Btn primary onClick={() => { if (newName.trim()) { addGroup({ name: newName.trim(), cols: 2 }); setNewName(""); } }}>+ Add Group</Btn>
      </div>
      {roomGroups.map(g => (
        <div key={g.id} style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong style={{ flex: 1 }}>{g.name}</strong>
            <label style={{ fontSize: 12, color: "#666" }}>Cols:</label>
            <input type="number" value={g.cols} min={1} max={4} onChange={e => setGroupCols(g.id, parseInt(e.target.value) || 2)} style={{ width: 50, height: 28, border: "0.5px solid #ccc", borderRadius: 6, textAlign: "center", fontSize: 13 }} />
            <ActBtn danger onClick={() => deleteGroup(g.id)}>Delete</ActBtn>
          </div>
          {roomsToShow.map(r => {
            const inThis = g.roomIds.includes(r.id);
            const inOther = roomGroups.find(og => og.id !== g.id && og.roomIds.includes(r.id));
            return (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 13, cursor: inOther && !inThis ? "not-allowed" : "pointer", opacity: inOther && !inThis ? 0.5 : 1 }} title={inOther && !inThis ? `Already in "${inOther.name}"` : ""}>
                <input type="checkbox" checked={inThis} disabled={!!(inOther && !inThis)} onChange={e => toggleGroupRoom(g.id, r.id, e.target.checked)} />
                {r.icon} {r.name}
                {inOther && !inThis && <span style={{ fontSize: 10, color: "#aaa", marginLeft: 4 }}>({inOther.name})</span>}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── SUPER ADMIN VIEW ────────────────────────────────────────────────────────
function SuperAdminView({ users, houses, rooms, items, storages, containers, moveLogs, lendLogs, isSuperAdmin }) {
  if (!isSuperAdmin) return <div style={{ color: "#888", textAlign: "center", padding: 32 }}>Super Admin only. Log in as Jacob to access.</div>;
  const totalLogins = users.reduce((a, u) => a + u.loginCount, 0);
  const lentCount = lendLogs.filter(l => !l.returned).length;
  const stats = [["Houses", houses.length], ["Rooms", rooms.length], ["Items", items.length], ["Users", users.length], ["Total Logins", totalLogins], ["Lent Out", lentCount], ["Storage Units", storages.length], ["Containers", containers.length]];
  const maxLogins = Math.max(...users.map(u => u.loginCount));
  const maxRoomItems = Math.max(...rooms.map(r => items.filter(i => i.roomId === r.id).length), 1);
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>📊 Platform Statistics</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 10, marginBottom: 16 }}>
        {stats.map(([l, v]) => <div key={l} style={{ background: "#f4f4f2", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 500 }}>{v}</div></div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <ChartCard title="Login Activity">
          {users.map(u => <BarRow key={u.id} label={u.name} val={u.loginCount} max={maxLogins} />)}
        </ChartCard>
        <ChartCard title="Items per Room">
          {rooms.map(r => { const c = items.filter(i => i.roomId === r.id).length; return <BarRow key={r.id} label={r.icon + " " + r.name} val={c} max={maxRoomItems} />; })}
        </ChartCard>
        <ChartCard title="Users by Role">
          {["superadmin", "admin", "subadmin", "regular", "guest"].map(role => { const c = users.filter(u => u.role === role).length; return c ? <BarRow key={role} label={role} val={c} max={users.length} /> : null; })}
        </ChartCard>
        <ChartCard title="Recent Activity">
          {[...moveLogs].reverse().slice(0, 8).map(l => {
            const item = items.find(i => i.id === l.itemId);
            return <div key={l.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "0.5px solid #f0f0ee" }}><strong>{l.userId}</strong> moved {item?.name} <span style={{ color: "#aaa" }}>· {l.ts}</span></div>;
          })}
        </ChartCard>
      </div>
    </div>
  );
}
function ChartCard({ title, children }) {
  return <div style={{ background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 12, padding: "14px 16px" }}><div style={{ fontWeight: 500, fontSize: 13, marginBottom: 10 }}>{title}</div>{children}</div>;
}
function BarRow({ label, val, max }) {
  const pct = max > 0 ? Math.round(val / max * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
      <div style={{ width: 90, color: "#888", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ flex: 1, height: 12, background: "#f0f0ee", borderRadius: 6, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: "#185FA5", borderRadius: 6 }} /></div>
      <div style={{ width: 28, color: "#888", fontSize: 11 }}>{val}</div>
    </div>
  );
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function Modal({ modal, setModal, rooms, storages, containers, tags, items, addItem, editItem, moveItem, lendItem, addTag, editTag, visibleRooms, showToast }) {
  const close = () => setModal(null);

  if (modal.type === "container") {
    const { container, storage, room } = modal;
    const cItems = items.filter(i => i.containerId === container.id);
    return (
      <ModalWrap onClose={close}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>📁 {container.name} <span style={{ fontSize: 12, color: "#888" }}>in {storage.name}</span></h2>
        {!cItems.length ? <div style={{ color: "#888", textAlign: "center", padding: 20 }}>No items</div> :
          cItems.map(i => <div key={i.id} style={{ padding: "6px 0", borderBottom: "0.5px solid #f0f0ee", fontSize: 13 }}>{i.name} — {i.qty} {i.unit}</div>)}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Btn onClick={() => { close(); setModal({ type: "addItem", preRoom: room.id, preStorage: storage.id, preContainer: container.id }); }} primary>+ Add Item Here</Btn>
          <Btn onClick={close}>Close</Btn>
        </div>
      </ModalWrap>
    );
  }

  if (modal.type === "addItem" || modal.type === "editItem") {
    return <ItemFormModal modal={modal} close={close} rooms={rooms} storages={storages} containers={containers} tags={tags} addItem={addItem} editItem={editItem} visibleRooms={visibleRooms} showToast={showToast} />;
  }
  if (modal.type === "move") {
    return <MoveModal item={modal.item} close={close} rooms={rooms} storages={storages} containers={containers} visibleRooms={visibleRooms} moveItem={moveItem} showToast={showToast} />;
  }
  if (modal.type === "lend") {
    return <LendModal item={modal.item} close={close} lendItem={lendItem} showToast={showToast} />;
  }
  if (modal.type === "addTag" || modal.type === "editTag") {
    return <TagFormModal modal={modal} close={close} addTag={addTag} editTag={editTag} />;
  }
  return null;
}

// ─── ITEM FORM MODAL ─────────────────────────────────────────────────────────
function ItemFormModal({ modal, close, rooms, storages, containers, tags, addItem, editItem, visibleRooms, showToast }) {
  const editing = modal.type === "editItem";
  const item = modal.item;
  const [name, setName] = useState(editing ? item.name : "");
  const [qty, setQty] = useState(editing ? item.qty : 1);
  const [unit, setUnit] = useState(editing ? item.unit : "piece");
  const [perishable, setPerishable] = useState(editing ? item.perishable : false);
  const [selTags, setSelTags] = useState(editing ? item.tagIds : []);
  const [selRoom, setSelRoom] = useState(modal.preRoom || (editing ? item.roomId : ""));
  const [selStorage, setSelStorage] = useState(modal.preStorage || (editing ? item.storageId : ""));
  const [selContainer, setSelContainer] = useState(modal.preContainer !== undefined ? modal.preContainer : (editing ? item.containerId : null));
  const [collapsedRooms, setCollapsedRooms] = useState(() => Object.fromEntries(rooms.map(r => [r.id, true])));
  const isPreset = !editing && modal.preStorage;

  const toggleTag = (id) => setSelTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const save = () => {
    if (!name.trim()) { showToast("Name required"); return; }
    if (!selStorage) { showToast("Location required"); return; }
    const data = {
      name: name.trim(),
      qty: perishable ? (parseFloat(qty) || 0) : 1,
      unit: perishable ? unit : "piece",
      perishable,
      tagIds: selTags,
      roomId: selRoom,
      storageId: selStorage,
      containerId: selContainer || null
    };
    if (editing) editItem(item.id, data); else addItem(data);
    close();
  };

  return (
    <ModalWrap onClose={close}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>{editing ? "Edit Item" : "Add Item"}</h2>
      <Field label="Item Name *"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rice, HDMI Cable" style={inputStyle} /></Field>

      <Field label="Type">
        <div style={{ display: "flex", gap: 0, border: "0.5px solid #ccc", borderRadius: 8, overflow: "hidden" }}>
          <button onClick={() => setPerishable(false)} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: perishable ? 400 : 500, background: perishable ? "#f9f9f8" : "#111", color: perishable ? "#555" : "#fff", transition: "all .15s" }}>🔩 Non-Perishable</button>
          <button onClick={() => setPerishable(true)} style={{ flex: 1, padding: "7px 0", border: "none", borderLeft: "0.5px solid #ccc", cursor: "pointer", fontSize: 13, fontWeight: perishable ? 500 : 400, background: perishable ? "#111" : "#f9f9f8", color: perishable ? "#fff" : "#555", transition: "all .15s" }}>🥬 Perishable</button>
        </div>
      </Field>

      {perishable && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Quantity *"><input type="number" value={qty} onChange={e => setQty(e.target.value)} min={0} style={inputStyle} /></Field>
          <Field label="Unit"><select value={unit} onChange={e => setUnit(e.target.value)} style={inputStyle}>
            {["piece", "kg", "g", "litre", "box", "pair", "ml", "dozen"].map(u => <option key={u}>{u}</option>)}
          </select></Field>
        </div>
      )}

      {isPreset ? (
        <Field label="Location (preset)">
          <div style={{ padding: 8, background: "#f9f9f8", borderRadius: 8, fontSize: 13 }}>
            {rooms.find(r => r.id === selRoom)?.name} › {storages.find(s => s.id === selStorage)?.name}{selContainer ? " › " + containers.find(c => c.id === selContainer)?.name : ""}
          </div>
        </Field>
      ) : (
        <Field label="Location *">
          <div style={{ border: "0.5px solid #ccc", borderRadius: 8, padding: 8, maxHeight: 200, overflowY: "auto" }}>
            {visibleRooms.map(r => {
              const rCollapsed = collapsedRooms[r.id];
              const rStorages = storages.filter(s => s.roomId === r.id);
              return (
                <div key={r.id}>
                  <div onClick={() => setCollapsedRooms(p => ({ ...p, [r.id]: !p[r.id] }))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", cursor: "pointer", borderRadius: 6, fontSize: 13 }}>
                    <span style={{ fontSize: 11, width: 12 }}>{rCollapsed ? "▸" : "▾"}</span>
                    <span>{r.icon} {r.name}</span>
                  </div>
                  {!rCollapsed && rStorages.map(s => {
                    const sContainers = containers.filter(c => c.storageId === s.id);
                    return (
                      <div key={s.id} style={{ paddingLeft: 18 }}>
                        <div onClick={() => { setSelRoom(r.id); setSelStorage(s.id); setSelContainer(null); }} style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 6, fontSize: 13, background: selStorage === s.id && !selContainer ? "#E6F1FB" : "transparent", color: selStorage === s.id && !selContainer ? "#0C447C" : "inherit" }}>
                          🗄️ {s.name}
                        </div>
                        <div style={{ paddingLeft: 16 }}>
                          {sContainers.map(c => (
                            <div key={c.id} onClick={() => { setSelRoom(r.id); setSelStorage(s.id); setSelContainer(c.id); }} style={{ padding: "3px 8px", cursor: "pointer", borderRadius: 6, fontSize: 12, background: selContainer === c.id ? "#E6F1FB" : "transparent", color: selContainer === c.id ? "#0C447C" : "inherit" }}>
                              📁 {c.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {selStorage && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Selected: {rooms.find(r => r.id === selRoom)?.name} › {storages.find(s => s.id === selStorage)?.name}{selContainer ? " › " + containers.find(c => c.id === selContainer)?.name : " (no container)"}</div>}
        </Field>
      )}

      <Field label="Tags">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {tags.map(t => (
            <span key={t.id} onClick={() => toggleTag(t.id)} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 10, cursor: "pointer", background: t.bg, color: t.fg, outline: selTags.includes(t.id) ? "2px solid #185FA5" : "none", outlineOffset: 1 }}>{t.name}</span>
          ))}
        </div>
      </Field>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn onClick={close}>Cancel</Btn>
        <Btn primary onClick={save}>{editing ? "Save" : "Add Item"}</Btn>
      </div>
    </ModalWrap>
  );
}

// ─── MOVE MODAL ──────────────────────────────────────────────────────────────
function MoveModal({ item, close, rooms, storages, containers, visibleRooms, moveItem, showToast }) {
  const [reason, setReason] = useState("");
  const [selRoom, setSelRoom] = useState(item.roomId);
  const [selStorage, setSelStorage] = useState(item.storageId);
  const [selContainer, setSelContainer] = useState(item.containerId);
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(rooms.map(r => [r.id, true])));

  const save = () => {
    if (!reason.trim()) { showToast("Reason required"); return; }
    if (!selStorage) { showToast("Select a location"); return; }
    moveItem(item.id, selRoom, selStorage, selContainer, reason);
    close();
  };

  return (
    <ModalWrap onClose={close}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Move: {item.name}</h2>
      <Field label="Reason *"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Reorganizing" style={inputStyle} /></Field>
      <Field label="New Location *">
        <div style={{ border: "0.5px solid #ccc", borderRadius: 8, padding: 8, maxHeight: 200, overflowY: "auto" }}>
          {visibleRooms.map(r => {
            const rCollapsed = collapsed[r.id];
            return (
              <div key={r.id}>
                <div onClick={() => setCollapsed(p => ({ ...p, [r.id]: !p[r.id] }))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", cursor: "pointer", fontSize: 13 }}>
                  <span style={{ fontSize: 11, width: 12 }}>{rCollapsed ? "▸" : "▾"}</span><span>{r.icon} {r.name}</span>
                </div>
                {!rCollapsed && storages.filter(s => s.roomId === r.id).map(s => (
                  <div key={s.id} style={{ paddingLeft: 18 }}>
                    <div onClick={() => { setSelRoom(r.id); setSelStorage(s.id); setSelContainer(null); }} style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 6, fontSize: 13, background: selStorage === s.id && !selContainer ? "#E6F1FB" : "transparent", color: selStorage === s.id && !selContainer ? "#0C447C" : "inherit" }}>🗄️ {s.name}</div>
                    <div style={{ paddingLeft: 16 }}>
                      {containers.filter(c => c.storageId === s.id).map(c => (
                        <div key={c.id} onClick={() => { setSelRoom(r.id); setSelStorage(s.id); setSelContainer(c.id); }} style={{ padding: "3px 8px", cursor: "pointer", borderRadius: 6, fontSize: 12, background: selContainer === c.id ? "#E6F1FB" : "transparent", color: selContainer === c.id ? "#0C447C" : "inherit" }}>📁 {c.name}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn onClick={close}>Cancel</Btn><Btn primary onClick={save}>Move</Btn>
      </div>
    </ModalWrap>
  );
}

// ─── LEND MODAL ──────────────────────────────────────────────────────────────
function LendModal({ item, close, lendItem, showToast }) {
  const [borrower, setBorrower] = useState("");
  const [qty, setQty] = useState(1);
  const save = () => {
    if (!borrower.trim()) { showToast("Borrower name required"); return; }
    if (item.perishable && qty > item.qty) { showToast("Not enough quantity"); return; }
    lendItem(item.id, borrower.trim(), item.perishable ? parseFloat(qty) : 1);
    close();
  };
  return (
    <ModalWrap onClose={close}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Lend: {item.name}</h2>
      <Field label="Borrower Name *"><input value={borrower} onChange={e => setBorrower(e.target.value)} placeholder="Who is borrowing?" style={inputStyle} /></Field>
      {item.perishable && <Field label={`Quantity to Lend (available: ${item.qty} ${item.unit})`}><input type="number" value={qty} onChange={e => setQty(e.target.value)} min={1} max={item.qty} style={inputStyle} /></Field>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn onClick={close}>Cancel</Btn><Btn primary onClick={save}>Lend</Btn>
      </div>
    </ModalWrap>
  );
}

// ─── TAG FORM MODAL ──────────────────────────────────────────────────────────
function TagFormModal({ modal, close, addTag, editTag }) {
  const editing = modal.type === "editTag";
  const t = modal.tag;
  const [name, setName] = useState(editing ? t.name : "");
  const [bg, setBg] = useState(editing ? t.bg : "#E6F1FB");
  const [fg, setFg] = useState(editing ? t.fg : "#0C447C");
  const save = () => {
    if (!name.trim()) return;
    if (editing) editTag(t.id, { name, bg, fg }); else addTag({ name, bg, fg });
    close();
  };
  return (
    <ModalWrap onClose={close}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 14 }}>{editing ? "Edit Tag" : "Add Tag"}</h2>
      <Field label="Tag Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fragile" style={inputStyle} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Background Color"><input type="color" value={bg} onChange={e => setBg(e.target.value)} style={{ ...inputStyle, padding: 2 }} /></Field>
        <Field label="Text Color"><input type="color" value={fg} onChange={e => setFg(e.target.value)} style={{ ...inputStyle, padding: 2 }} /></Field>
      </div>
      <div style={{ marginTop: 8 }}>Preview: <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: bg, color: fg }}>{name || "Tag"}</span></div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn onClick={close}>Cancel</Btn><Btn primary onClick={save}>Save</Btn>
      </div>
    </ModalWrap>
  );
}

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────
function ModalWrap({ onClose, children }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, border: "0.5px solid #ccc", padding: 20, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>{label}</label>{children}</div>;
}
const inputStyle = { width: "100%", height: 34, border: "0.5px solid #ccc", borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#f9f9f8" };
function Btn({ children, primary, danger, onClick }) {
  return <button onClick={onClick} style={{ padding: "5px 14px", border: `0.5px solid ${primary ? "#185FA5" : danger ? "#A32D2D" : "#ccc"}`, borderRadius: 8, background: primary ? "#185FA5" : danger ? "#A32D2D" : "#fff", color: primary || danger ? "#fff" : "#333", cursor: "pointer", fontSize: 13 }}>{children}</button>;
}
function ActBtn({ children, danger, onClick }) {
  return <button onClick={onClick} style={{ fontSize: 11, padding: "3px 8px", border: "0.5px solid #ddd", borderRadius: 6, cursor: "pointer", background: "#f9f9f8", color: danger ? "#A32D2D" : "#333" }}>{children}</button>;
}
