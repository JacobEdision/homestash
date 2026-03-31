
import { useState, useMemo, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

function mapUser(u)  { return { ...u, houseId: u.house_id, loginCount: u.login_count, lastLogin: u.last_login }; }
function mapRoom(r)  { return { ...r, houseId: r.house_id }; }
function mapStorage(s) { return { ...s, roomId: s.room_id }; }
function mapContainer(c) { return { ...c, storageId: c.storage_id }; }
function mapItem(i)  { return { ...i, storageId: i.storage_id, containerId: i.container_id || null, roomId: i.room_id, tagIds: Array.isArray(i.tag_ids) ? i.tag_ids : [], perishable: Boolean(i.perishable), borrower: i.borrower || null }; }
function mapMoveLog(l) { return { ...l, itemId: l.item_id, fromRoom: l.from_room, toRoom: l.to_room, userId: l.user_id }; }
function mapLendLog(l) { return { ...l, itemId: l.item_id, userId: l.user_id, returned: Boolean(l.returned) }; }
function mapGroup(g) { return { ...g, roomIds: Array.isArray(g.room_ids) ? g.room_ids : [] }; }
function mapGuestPerm(p) { return { userId: p.user_id, roomId: p.room_id }; }
function itemToDb(i) { return { id: i.id, name: i.name, storage_id: i.storageId, container_id: i.containerId || null, room_id: i.roomId, qty: i.qty, unit: i.unit, perishable: i.perishable, tag_ids: i.tagIds, status: i.status, borrower: i.borrower || null }; }
function groupToDb(g) { return { id: g.id, name: g.name, room_ids: g.roomIds, cols: g.cols }; }

const db = {
  getAll: async (table) => { const { data, error } = await supabase.from(table).select("*"); if (error) { console.error(table, error); return []; } return data || []; },
  upsert: async (table, row) => { const { error } = await supabase.from(table).upsert(row); if (error) console.error(table, error); },
  insert: async (table, row) => { const { error } = await supabase.from(table).insert(row); if (error) console.error(table, error); },
  update: async (table, id, fields) => { const { error } = await supabase.from(table).update(fields).eq("id", id); if (error) console.error(table, error); },
  delete: async (table, id) => { const { error } = await supabase.from(table).delete().eq("id", id); if (error) console.error(table, error); },
};

const ROLE_COLORS = { superadmin:{bg:"#EEEDFE",fg:"#3C3489"},admin:{bg:"#E6F1FB",fg:"#0C447C"},subadmin:{bg:"#EAF3DE",fg:"#27500A"},regular:{bg:"#F1EFE8",fg:"#444441"},guest:{bg:"#FAEEDA",fg:"#633806"} };
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");

function autoFg(hex) {
  const c = hex.replace("#",""); const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);
  return (r*299+g*587+b*114)/1000>128?"#1a1a1a":"#ffffff";
}

const LIGHT = { bg:"#ffffff",bgSec:"#f9f9f8",bgTer:"#f4f4f2",border:"#e5e5e5",borderSec:"#d0d0d0",text:"#111111",textSec:"#555555",textTer:"#888888",sidebar:"#ffffff",header:"#ffffff",cardBg:"#ffffff",cardOos:"#f9f9f8",inputBg:"#f9f9f8",activeBg:"#f4f4f2" };
const DARK  = { bg:"#1a1a1a",bgSec:"#242424",bgTer:"#2e2e2e",border:"#333333",borderSec:"#444444",text:"#f0f0f0",textSec:"#aaaaaa",textTer:"#777777",sidebar:"#1e1e1e",header:"#1e1e1e",cardBg:"#242424",cardOos:"#1e1e1e",inputBg:"#2e2e2e",activeBg:"#2e2e2e" };
const iS = (T) => ({ width:"100%",height:34,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"0 10px",fontSize:13,background:T.inputBg,color:T.text,display:"block",boxSizing:"border-box" });

export default function App() {
  const [users,setUsers]=useState([]); const [houses,setHouses]=useState([]); const [tags,setTags]=useState([]);
  const [roomGroups,setRoomGroups]=useState([]); const [rooms,setRooms]=useState([]); const [storages,setStorages]=useState([]);
  const [containers,setContainers]=useState([]); const [items,setItems]=useState([]); const [moveLogs,setMoveLogs]=useState([]);
  const [lendLogs,setLendLogs]=useState([]); const [guestPerms,setGuestPerms]=useState([]); const [loading,setLoading]=useState(true);
  const [currentUserId,setCurrentUserId]=useState("alice"); const [view,setView]=useState("home"); const [roomId,setRoomId]=useState(null);
  const [filterConsumable,setFilterConsumable]=useState(null); const [search,setSearch]=useState(""); const [modal,setModal]=useState(null);
  const [toast,setToast]=useState(null); const [darkMode,setDarkMode]=useState(false); const [showOos,setShowOos]=useState(false);
  const T = darkMode ? DARK : LIGHT;

  useEffect(() => {
    Promise.all([
      db.getAll("users").then(d=>setUsers(d.map(mapUser))),db.getAll("houses").then(d=>setHouses(d)),
      db.getAll("tags").then(d=>setTags(d)),db.getAll("room_groups").then(d=>setRoomGroups(d.map(mapGroup))),
      db.getAll("rooms").then(d=>setRooms(d.map(mapRoom))),db.getAll("storages").then(d=>setStorages(d.map(mapStorage))),
      db.getAll("containers").then(d=>setContainers(d.map(mapContainer))),db.getAll("items").then(d=>setItems(d.map(mapItem))),
      db.getAll("move_logs").then(d=>setMoveLogs(d.map(mapMoveLog))),db.getAll("lend_logs").then(d=>setLendLogs(d.map(mapLendLog))),
      db.getAll("guest_permissions").then(d=>setGuestPerms(d.map(mapGuestPerm))),
    ]).then(()=>setLoading(false)).catch(e=>{console.error(e);setLoading(false);});
  }, []);

  const currentUser = users.find(u=>u.id===currentUserId)||{id:"alice",name:"Loading…",role:"regular"};
  const canEdit = ["admin","subadmin"].includes(currentUser.role);
  const canAdmin = currentUser.role==="admin";
  const isSuperAdmin = currentUser.role==="superadmin";
  const showToast = useCallback((msg)=>{setToast(msg);setTimeout(()=>setToast(null),2200);},[]);

  const visibleRooms = useMemo(()=>{
    if(currentUser.role==="guest"){const a=guestPerms.filter(p=>p.userId===currentUser.id).map(p=>p.roomId);return rooms.filter(r=>a.includes(r.id));}
    return rooms.filter(r=>r.houseId==="h1");
  },[currentUser,guestPerms,rooms]);

  const filteredItems = useCallback((list)=>{
    let r=list;
    if(filterConsumable!==null)r=r.filter(i=>i.perishable===filterConsumable);
    if(search)r=r.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  },[filterConsumable,search]);

  const oosItems = items.filter(i=>i.status==="out_of_stock"||(i.perishable&&i.qty===0));

  const cycleUser=()=>{const idx=users.findIndex(u=>u.id===currentUserId);const next=users[(idx+1)%users.length];setCurrentUserId(next.id);if(next.role==="superadmin")setView("superadmin");else if(view==="superadmin")setView("home");showToast(`Switched to ${next.name} (${next.role})`);};
  const nav=(v,rid=null)=>{setView(v);if(rid)setRoomId(rid);setSearch("");};

  const addItem=async(data)=>{const n={id:"i"+uid(),...data,status:"normal",borrower:null};await db.upsert("items",itemToDb(n));setItems(p=>[...p,n]);showToast("Item added!");};
  const editItem=async(id,data)=>{const u={...items.find(i=>i.id===id),...data};await db.upsert("items",itemToDb(u));setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item updated");};
  const deleteItem=async(id)=>{await db.delete("items",id);setItems(p=>p.filter(i=>i.id!==id));showToast("Item deleted");};
  const markOos=async(id)=>{const item=items.find(i=>i.id===id);const ns=item.status==="out_of_stock"?"normal":"out_of_stock";await db.update("items",id,{status:ns});setItems(p=>p.map(i=>i.id===id?{...i,status:ns}:i));showToast(ns==="out_of_stock"?"Marked out of stock":"Back in stock");};
  const moveItem=async(id,nR,nS,nC,reason)=>{const item=items.find(i=>i.id===id);const log={id:"ml"+uid(),item_id:id,from_room:item.roomId,to_room:nR,reason,user_id:currentUserId,ts:now()};await db.insert("move_logs",log);const u={...item,roomId:nR,storageId:nS,containerId:nC};await db.upsert("items",itemToDb(u));setMoveLogs(p=>[...p,mapMoveLog(log)]);setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item moved!");};
  const lendItem=async(id,borrower,qty)=>{const item=items.find(i=>i.id===id);const log={id:"ll"+uid(),item_id:id,borrower,qty,user_id:currentUserId,ts:now(),returned:false};await db.insert("lend_logs",log);const u={...item,status:"lent",borrower,qty:item.perishable?item.qty-qty:item.qty};await db.upsert("items",itemToDb(u));setLendLogs(p=>[...p,mapLendLog(log)]);setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item lent to "+borrower);};
  const returnItem=async(id)=>{const log=lendLogs.find(l=>l.itemId===id&&!l.returned);const item=items.find(i=>i.id===id);if(log)await db.update("lend_logs",log.id,{returned:true});const bq=(item.perishable&&log)?item.qty+log.qty:item.qty;const u={...item,status:"normal",borrower:null,qty:bq};await db.upsert("items",itemToDb(u));if(log)setLendLogs(p=>p.map(l=>l.id===log.id?{...l,returned:true}:l));setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item returned");};

  const addTag=async(t)=>{const n={id:"t"+uid(),...t};await db.upsert("tags",n);setTags(p=>[...p,n]);showToast("Tag added");};
  const editTag=async(id,t)=>{const u={...tags.find(x=>x.id===id),...t};await db.upsert("tags",u);setTags(p=>p.map(x=>x.id===id?u:x));showToast("Tag updated");};
  const deleteTag=async(id)=>{await db.delete("tags",id);setTags(p=>p.filter(x=>x.id!==id));setItems(p=>p.map(i=>({...i,tagIds:i.tagIds.filter(t=>t!==id)})));showToast("Tag deleted");};
  const changeRole=async(id,role)=>{await db.update("users",id,{role});setUsers(p=>p.map(u=>u.id===id?{...u,role}:u));showToast("Role updated");};

  const addRoom=async(r)=>{const n={id:"r"+uid(),house_id:"h1",...r};await db.upsert("rooms",n);setRooms(p=>[...p,mapRoom(n)]);showToast("Room added");};
  const deleteRoom=async(id)=>{await db.delete("rooms",id);setRooms(p=>p.filter(r=>r.id!==id));showToast("Room deleted");};
  const addStorage=async(s)=>{const n={id:"s"+uid(),...s};await db.upsert("storages",n);setStorages(p=>[...p,mapStorage(n)]);showToast("Storage unit added");};
  const deleteStorage=async(id)=>{await db.delete("storages",id);setStorages(p=>p.filter(s=>s.id!==id));showToast("Storage unit deleted");};
  const addContainer=async(c)=>{const n={id:"c"+uid(),...c};await db.upsert("containers",n);setContainers(p=>[...p,mapContainer(n)]);showToast("Container added");};
  const deleteContainer=async(id)=>{await db.delete("containers",id);setContainers(p=>p.filter(c=>c.id!==id));showToast("Container deleted");};

  const addGroup=async(g)=>{const n={id:"g"+uid(),...g,roomIds:[]};await db.upsert("room_groups",groupToDb(n));setRoomGroups(p=>[...p,n]);};
  const deleteGroup=async(id)=>{await db.delete("room_groups",id);setRoomGroups(p=>p.filter(g=>g.id!==id));};
  const toggleGroupRoom=async(gid,rid,checked)=>{if(checked){const a=roomGroups.find(g=>g.id!==gid&&g.roomIds.includes(rid));if(a){showToast(`"${rooms.find(r=>r.id===rid)?.name}" is already in "${a.name}"`);return;}}const upd=roomGroups.map(g=>g.id!==gid?g:{...g,roomIds:checked?[...g.roomIds,rid]:g.roomIds.filter(x=>x!==rid)});await db.upsert("room_groups",groupToDb(upd.find(g=>g.id===gid)));setRoomGroups(upd);};
  const setGroupCols=async(gid,cols)=>{const upd=roomGroups.map(g=>g.id!==gid?g:{...g,cols});await db.upsert("room_groups",groupToDb(upd.find(g=>g.id===gid)));setRoomGroups(upd);};

  const exportCSV=()=>{const rows=items.map(i=>{const room=rooms.find(r=>r.id===i.roomId);const house=room?houses.find(h=>h.id===room.houseId):null;const storage=storages.find(s=>s.id===i.storageId);const container=i.containerId?containers.find(c=>c.id===i.containerId):null;return[house?.name,room?.name,storage?.name,container?.name||"",i.name,i.qty,i.unit,i.perishable?"Consumable":"Asset",i.status,i.borrower||"",i.tagIds.map(tid=>tags.find(t=>t.id===tid)?.name).filter(Boolean).join(";")].map(v=>`"${v}"`).join(",");});const csv=["House,Room,Storage,Container,Item,Qty,Unit,Type,Status,Borrower,Tags",...rows].join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="inventory.csv";a.click();showToast("CSV exported!");};

  const sp={T,tags,rooms,storages,containers,items,canEdit,canAdmin,isSuperAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem,returnItem,markOos,nav};

  if(loading)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:T.bg,color:T.text,fontFamily:"system-ui,sans-serif",flexDirection:"column",gap:12}}><div style={{fontSize:32}}>🏠</div><div style={{fontSize:16,fontWeight:500}}>HomeStash</div><div style={{fontSize:13,color:T.textSec}}>Loading data…</div></div>;

  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"system-ui,sans-serif",fontSize:14,background:T.bg,color:T.text}}>
      <Sidebar view={view} nav={nav} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} currentUser={currentUser} lendLogs={lendLogs} filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} exportCSV={exportCSV} cycleUser={cycleUser} T={T}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <Header search={search} setSearch={setSearch} canEdit={canEdit} openAddItem={()=>setModal({type:"addItem"})} darkMode={darkMode} setDarkMode={setDarkMode} oosCount={oosItems.length} showOos={showOos} setShowOos={setShowOos} T={T}/>
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {showOos&&<OosPanel items={oosItems} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T} onClose={()=>setShowOos(false)}/>}
          {!showOos&&view==="home"&&<HomeView {...sp} roomGroups={roomGroups} visibleRooms={visibleRooms} search={search}/>}
          {!showOos&&view==="room"&&<RoomView {...sp} roomId={roomId}/>}
          {!showOos&&view==="allitems"&&<AllItemsView {...sp}/>}
          {!showOos&&view==="lentout"&&<LentOutView items={items} lendLogs={lendLogs} rooms={rooms} returnItem={returnItem} T={T}/>}
          {!showOos&&view==="auditlog"&&<AuditLogView moveLogs={moveLogs} items={items} rooms={rooms} T={T}/>}
          {!showOos&&view==="tags"&&<TagsView tags={tags} canAdmin={canAdmin} setModal={setModal} deleteTag={deleteTag} T={T}/>}
          {!showOos&&view==="users"&&<UsersView users={users} currentUserId={currentUserId} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} houses={houses} changeRole={changeRole} T={T}/>}
          {!showOos&&view==="places"&&<PlacesView rooms={rooms} storages={storages} containers={containers} canAdmin={canAdmin} addRoom={addRoom} deleteRoom={deleteRoom} addStorage={addStorage} deleteStorage={deleteStorage} addContainer={addContainer} deleteContainer={deleteContainer} T={T}/>}
          {!showOos&&view==="groups"&&<GroupsView roomGroups={roomGroups} rooms={visibleRooms} canAdmin={canAdmin} addGroup={addGroup} deleteGroup={deleteGroup} toggleGroupRoom={toggleGroupRoom} setGroupCols={setGroupCols} showToast={showToast} allRooms={rooms} T={T}/>}
          {!showOos&&view==="superadmin"&&<SuperAdminView users={users} houses={houses} rooms={rooms} items={items} storages={storages} containers={containers} moveLogs={moveLogs} lendLogs={lendLogs} isSuperAdmin={isSuperAdmin} T={T}/>}
        </div>
      </div>
      {modal&&<Modal modal={modal} setModal={setModal} rooms={rooms} storages={storages} containers={containers} tags={tags} items={items} addItem={addItem} editItem={editItem} moveItem={moveItem} lendItem={lendItem} addTag={addTag} editTag={editTag} visibleRooms={visibleRooms} showToast={showToast} T={T}/>}
      {toast&&<div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"8px 18px",fontSize:13,zIndex:9999,color:T.text}}>{toast}</div>}
    </div>
  );
}

function Sidebar({view,nav,canAdmin,isSuperAdmin,currentUser,lendLogs,filterConsumable,setFilterConsumable,exportCSV,cycleUser,T}){
  const lentCount=lendLogs.filter(l=>!l.returned).length;
  const rc=ROLE_COLORS[currentUser.role]||ROLE_COLORS.regular;
  const SBItem=({v,icon,label,badge})=>(
    <div onClick={()=>nav(v)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",cursor:"pointer",fontSize:13,color:view===v?T.text:T.textSec,fontWeight:view===v?500:400,background:view===v?T.activeBg:"transparent"}}>
      <span style={{fontSize:14,width:16,textAlign:"center"}}>{icon}</span><span style={{flex:1}}>{label}</span>
      {badge!==undefined&&<span style={{background:"#E6F1FB",color:"#0C447C",fontSize:10,padding:"1px 6px",borderRadius:10}}>{badge}</span>}
    </div>
  );
  const bottom=(<div style={{marginTop:"auto",padding:"12px 16px",borderTop:`0.5px solid ${T.border}`,display:"flex",alignItems:"center",gap:8}}>
    <div onClick={cycleUser} style={{width:28,height:28,borderRadius:"50%",background:"#E6F1FB",color:"#0C447C",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,cursor:"pointer"}}>{currentUser.name.slice(0,2).toUpperCase()}</div>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.name}</div><span style={{fontSize:10,padding:"1px 6px",borderRadius:10,background:rc.bg,color:rc.fg,fontWeight:500}}>{currentUser.role}</span></div>
  </div>);
  if(isSuperAdmin)return(
    <div style={{width:220,background:T.sidebar,borderRight:`0.5px solid ${T.border}`,display:"flex",flexDirection:"column",overflowY:"auto",flexShrink:0}}>
      <div style={{padding:"14px 16px 10px",fontWeight:500,fontSize:15,borderBottom:`0.5px solid ${T.border}`,color:T.text}}>🏠 HomeStash</div>
      <div style={{padding:"8px 16px 4px",fontSize:11,color:T.textTer,textTransform:"uppercase",letterSpacing:".07em",marginTop:4}}>Super Admin</div>
      <SBItem v="superadmin" icon="📊" label="Statistics"/><SBItem v="users" icon="👥" label="Users"/>{bottom}
    </div>
  );
  return(
    <div style={{width:220,background:T.sidebar,borderRight:`0.5px solid ${T.border}`,display:"flex",flexDirection:"column",overflowY:"auto",flexShrink:0}}>
      <div style={{padding:"14px 16px 10px",fontWeight:500,fontSize:15,borderBottom:`0.5px solid ${T.border}`,color:T.text}}>🏠 HomeStash</div>
      <SBItem v="home" icon="🏠" label="Rooms"/>
      <SBItem v="allitems" icon="📦" label="All Items"/>
      <div style={{padding:"3px 16px 3px 32px",fontSize:11,color:T.textTer}}>Filter by type</div>
      {[["· All",null],["📦 Consumable",true],["🔧 Asset",false]].map(([label,val])=>(
        <div key={label} onClick={()=>{setFilterConsumable(val);nav("allitems");}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 16px 5px 32px",cursor:"pointer",fontSize:12,color:filterConsumable===val?T.text:T.textSec,fontWeight:filterConsumable===val?500:400}}>{label}</div>
      ))}
      <SBItem v="lentout" icon="🤝" label="Lent Out" badge={lentCount}/>
      <SBItem v="auditlog" icon="📋" label="Audit Log"/>
      {canAdmin&&<>
        <div style={{padding:"8px 16px 4px",fontSize:11,color:T.textTer,textTransform:"uppercase",letterSpacing:".07em",marginTop:8}}>Admin</div>
        <SBItem v="places" icon="🏗️" label="Rooms & Storage"/>
        <SBItem v="tags" icon="🏷️" label="Manage Tags"/>
        <SBItem v="users" icon="👥" label="Users"/>
        <SBItem v="groups" icon="🗂️" label="Room Groups"/>
        <div onClick={exportCSV} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",cursor:"pointer",fontSize:13,color:T.textSec}}><span style={{fontSize:14,width:16}}>⬇️</span> Export CSV</div>
      </>}
      {bottom}
    </div>
  );
}

function Header({search,setSearch,canEdit,openAddItem,darkMode,setDarkMode,oosCount,showOos,setShowOos,T}){
  return(
    <div style={{height:48,background:T.header,borderBottom:`0.5px solid ${T.border}`,display:"flex",alignItems:"center",padding:"0 16px",gap:12,flexShrink:0}}>
      <div style={{position:"relative",width:380}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items, rooms, tags…" style={{width:"100%",height:32,border:`0.5px solid ${T.borderSec}`,borderRadius:8,padding:"0 32px 0 10px",fontSize:13,background:T.inputBg,color:T.text}}/>
        {search&&<span onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:T.textTer,fontSize:15}}>✕</span>}
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
        <div onClick={()=>setShowOos(p=>!p)} style={{position:"relative",cursor:"pointer",width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,background:showOos?T.activeBg:"transparent"}} title="Out of stock items">
          <span style={{fontSize:18}}>🔔</span>
          {oosCount>0&&<span style={{position:"absolute",top:2,right:2,background:"#E24B4A",color:"#fff",fontSize:9,fontWeight:700,padding:"1px 4px",borderRadius:10,minWidth:14,textAlign:"center"}}>{oosCount}</span>}
        </div>
        <div onClick={()=>setDarkMode(p=>!p)} title={darkMode?"Light mode":"Dark mode"} style={{cursor:"pointer",width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,fontSize:16}}>{darkMode?"☀️":"🌙"}</div>
        {canEdit&&<Btn primary onClick={openAddItem} T={T}>+ Add Item</Btn>}
      </div>
    </div>
  );
}

function OosPanel({items,tags,rooms,storages,containers,canEdit,canAdmin,setModal,deleteItem,returnItem,markOos,T,onClose}){
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:500,color:T.text}}>🔔 Out of Stock</div>
        <span style={{background:"#E24B4A",color:"#fff",fontSize:11,padding:"2px 8px",borderRadius:10}}>{items.length}</span>
        <div style={{marginLeft:"auto"}}><Btn onClick={onClose} T={T}>✕ Close</Btn></div>
      </div>
      {!items.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items are out of stock</div>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
          {items.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
        </div>}
    </div>
  );
}

function FilterPills({filterConsumable,setFilterConsumable,T}){
  const Pill=({val,label})=>(<span onClick={()=>setFilterConsumable(val)} style={{padding:"4px 10px",border:`0.5px solid ${T.borderSec}`,borderRadius:20,fontSize:12,cursor:"pointer",background:filterConsumable===val?T.text:T.bgTer,color:filterConsumable===val?T.bg:T.textSec}}>{label}</span>);
  return<div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}><Pill val={null} label="All"/><Pill val={true} label="📦 Consumable"/><Pill val={false} label="🔧 Asset"/></div>;
}

function HomeView({T,roomGroups,visibleRooms,canAdmin,nav,items,tags,storages,search,filteredItems}){
  if(search){const found=filteredItems(items);return<div><div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Search Results</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>{found.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={visibleRooms} storages={storages} containers={[]} compact T={T}/>)}</div></div>;}
  const groupedIds=roomGroups.flatMap(g=>g.roomIds);const ungrouped=visibleRooms.filter(r=>!groupedIds.includes(r.id));
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Rooms</div>
    {roomGroups.map(g=>{const gR=visibleRooms.filter(r=>g.roomIds.includes(r.id));if(!gR.length)return null;return<div key={g.id} style={{marginBottom:20}}>
      <div style={{fontSize:11,fontWeight:500,color:T.textTer,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>{g.name}{canAdmin&&<span onClick={()=>nav("groups")} style={{cursor:"pointer",color:T.textTer,fontSize:11}}>[edit]</span>}</div>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${g.cols},1fr)`,gap:10}}>{gR.map(r=><RoomCard key={r.id} room={r} items={items.filter(i=>i.roomId===r.id)} storages={storages.filter(s=>s.roomId===r.id)} tags={tags} nav={nav} T={T}/>)}</div>
    </div>;})}
    {ungrouped.length>0&&<div style={{marginBottom:20}}><div style={{fontSize:11,fontWeight:500,color:T.textTer,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Other Rooms</div><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>{ungrouped.map(r=><RoomCard key={r.id} room={r} items={items.filter(i=>i.roomId===r.id)} storages={storages.filter(s=>s.roomId===r.id)} tags={tags} nav={nav} T={T}/>)}</div></div>}
  </div>);
}

function RoomCard({room,items,storages,tags,nav,T}){
  const u=[...new Set(items.flatMap(i=>i.tagIds))].slice(0,4);
  return(<div onClick={()=>nav("room",room.id)} style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:14,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.borderSec} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
    <div style={{fontSize:14,fontWeight:500,marginBottom:4,color:T.text}}>{room.icon} {room.name}</div>
    <div style={{fontSize:12,color:T.textSec}}>{items.length} items · {storages.length} storage units</div>
    {u.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>{u.map(tid=>{const t=tags.find(x=>x.id===tid);return t?<span key={tid} style={{fontSize:11,padding:"2px 7px",borderRadius:10,background:t.bg,color:t.fg}}>{t.name}</span>:null;})}</div>}
  </div>);
}

function RoomView({T,roomId,rooms,storages,containers,items,tags,canEdit,canAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem,returnItem,markOos,nav}){
  const [collapsed,setCollapsed]=useState({});
  const room=rooms.find(r=>r.id===roomId);
  if(!room)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Room not found</div>;
  const roomStorages=storages.filter(s=>s.roomId===roomId);
  return(<div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
      <span onClick={()=>nav("home")} style={{cursor:"pointer",color:T.textSec,fontSize:13}}>← Rooms</span>
      <span style={{color:T.textTer}}>/</span>
      <span style={{fontSize:16,fontWeight:500,color:T.text}}>{room.icon} {room.name}</span>
    </div>
    <FilterPills filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} T={T}/>
    {roomStorages.map(s=>{
      const sC=containers.filter(c=>c.storageId===s.id);
      const isC=collapsed[s.id];
      const directItems=filteredItems(items.filter(i=>i.storageId===s.id&&!i.containerId));
      return(<div key={s.id} style={{marginBottom:16}}>
        <div onClick={()=>setCollapsed(p=>({...p,[s.id]:!p[s.id]}))} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:500,flex:1,color:T.text}}>🗄️ {s.name}</span>
          {canEdit&&<span onClick={e=>{e.stopPropagation();setModal({type:"addItem",preRoom:roomId,preStorage:s.id,preContainer:null});}} style={{fontSize:11,padding:"3px 8px",border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",background:T.bg,color:T.text}}>+ Add Item</span>}
          <span style={{fontSize:11,color:T.textTer}}>{isC?"▸":"▾"}</span>
        </div>
        {!isC&&<>
          {sC.map(c=>{
            const cItems=filteredItems(items.filter(i=>i.containerId===c.id));
            return(<div key={c.id} style={{marginBottom:12,marginLeft:8,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:T.bgTer}}>
                <span style={{fontSize:12,fontWeight:500,color:T.text,flex:1}}>📁 {c.name}</span>
                <span style={{fontSize:11,color:T.textTer}}>{cItems.length} items</span>
                {canEdit&&<span onClick={()=>setModal({type:"addItem",preRoom:roomId,preStorage:s.id,preContainer:c.id})} style={{fontSize:11,padding:"2px 7px",border:`0.5px solid ${T.border}`,borderRadius:5,cursor:"pointer",background:T.bg,color:T.text}}>+ Add</span>}
              </div>
              {cItems.length>0&&<div style={{padding:"8px 8px 4px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
                {cItems.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
              </div>}
              {cItems.length===0&&<div style={{padding:"8px 12px",fontSize:12,color:T.textTer}}>Empty container</div>}
            </div>);
          })}
          {directItems.length>0&&<>
            <div style={{fontSize:11,color:T.textTer,marginBottom:6,marginLeft:4}}>Direct items (no container):</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
              {directItems.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
            </div>
          </>}
        </>}
      </div>);
    })}
  </div>);
}

function AllItemsView({T,items,tags,rooms,storages,containers,canEdit,canAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem,returnItem,markOos}){
  const filtered=filteredItems(items);
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>All Items</div>
    <FilterPills filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} T={T}/>
    {!filtered.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items found</div>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        {filtered.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
      </div>}
  </div>);
}

function ItemCard({item,tags,rooms,storages,containers,canEdit,canAdmin,setModal,deleteItem,returnItem,markOos,compact,T}){
  const oos=item.status==="out_of_stock"||(item.perishable&&item.qty===0);
  const lent=item.status==="lent";
  const room=rooms.find(r=>r.id===item.roomId);
  const storage=storages.find(s=>s.id===item.storageId);
  const container=item.containerId?containers.find(c=>c.id===item.containerId):null;
  return(<div style={{background:oos?T.cardOos:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:12,position:"relative",opacity:oos?.65:1}}>
    {oos&&<span style={{position:"absolute",top:10,right:10,background:"#F7C1C1",color:"#791F1F",fontSize:10,padding:"2px 6px",borderRadius:10}}>Out of Stock</span>}
    {lent&&!oos&&<span style={{position:"absolute",top:10,right:10,background:"#FAC775",color:"#412402",fontSize:10,padding:"2px 6px",borderRadius:10}}>Lent: {item.borrower}</span>}
    <div style={{fontSize:13,fontWeight:500,marginBottom:3,paddingRight:lent||oos?70:0,color:T.text}}>{item.name}</div>
    <div style={{fontSize:11,color:T.textSec,marginBottom:2}}>{room?.name} › {storage?.name}{container?" › "+container.name:""}</div>
    {item.perishable&&<div style={{fontSize:12,color:T.textSec}}>Qty: {item.qty} {item.unit}</div>}
    <div style={{fontSize:10,color:T.textTer}}>{item.perishable?"📦 Consumable":"🔧 Asset"}</div>
    {item.tagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:5}}>{item.tagIds.map(tid=>{const t=tags.find(x=>x.id===tid);return t?<span key={tid} style={{fontSize:10,padding:"1px 5px",borderRadius:8,background:t.bg,color:t.fg}}>{t.name}</span>:null;})}</div>}
    {!compact&&(canEdit||canAdmin)&&(<div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
      {canEdit&&<ActBtn onClick={()=>setModal({type:"move",item})} T={T}>Move</ActBtn>}
      {canEdit&&!lent&&<ActBtn onClick={()=>setModal({type:"lend",item})} T={T}>Lend</ActBtn>}
      {lent&&<ActBtn onClick={()=>returnItem(item.id)} T={T}>Return</ActBtn>}
      {canEdit&&markOos&&<ActBtn onClick={()=>markOos(item.id)} T={T}>{oos?"In Stock":"Out of Stock"}</ActBtn>}
      {canEdit&&<ActBtn onClick={()=>setModal({type:"editItem",item})} T={T}>Edit</ActBtn>}
      {canAdmin&&<ActBtn danger onClick={()=>deleteItem(item.id)} T={T}>Del</ActBtn>}
    </div>)}
  </div>);
}

function LentOutView({items,lendLogs,rooms,returnItem,T}){
  const active=lendLogs.filter(l=>!l.returned);
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Lent Out Items</div>
    {!active.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items currently lent out</div>:
      <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12}}>
        {active.map(l=>{const item=items.find(i=>i.id===l.itemId);const room=item?rooms.find(r=>r.id===item.roomId):null;
          return<div key={l.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:`0.5px solid ${T.border}`}}>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:500,color:T.text}}>{item?.name}</div><div style={{fontSize:12,color:T.textSec}}>Borrower: <strong>{l.borrower}</strong> · Qty: {l.qty} · {room?.name}</div><div style={{fontSize:11,color:T.textTer}}>{l.ts} · by {l.userId}</div></div>
            <Btn onClick={()=>returnItem(item.id)} T={T}>Return</Btn>
          </div>;
        })}
      </div>}
  </div>);
}

function AuditLogView({moveLogs,items,rooms,T}){
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Audit / Move Log</div>
    {!moveLogs.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No logs yet</div>:
      <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12}}>
        {[...moveLogs].reverse().map(l=>{const item=items.find(i=>i.id===l.itemId);const fR=rooms.find(r=>r.id===l.fromRoom);const tR=rooms.find(r=>r.id===l.toRoom);
          return<div key={l.id} style={{padding:"8px 14px",borderBottom:`0.5px solid ${T.border}`,fontSize:12}}>
            <div style={{color:T.text}}><strong>{item?.name||"Unknown"}</strong> moved from <em>{fR?.name||"?"}</em> → <em>{tR?.name||"?"}</em></div>
            <div style={{color:T.textSec}}>Reason: {l.reason} · By: {l.userId}</div>
            <div style={{color:T.textTer,fontSize:11}}>{l.ts}</div>
          </div>;
        })}
      </div>}
  </div>);
}

function TagsView({tags,canAdmin,setModal,deleteTag,T}){
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;
  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontSize:16,fontWeight:500,color:T.text}}>Manage Tags</div>
      <Btn primary onClick={()=>setModal({type:"addTag"})} T={T}>+ Add Tag</Btn>
    </div>
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12}}>
      {tags.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`0.5px solid ${T.border}`}}>
        <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,background:t.bg,color:t.fg}}>{t.name}</span>
        <span style={{flex:1}}/>
        <ActBtn onClick={()=>setModal({type:"editTag",tag:t})} T={T}>Edit</ActBtn>
        <ActBtn danger onClick={()=>deleteTag(t.id)} T={T}>Delete</ActBtn>
      </div>)}
    </div>
  </div>);
}

function PlacesView({rooms,storages,containers,canAdmin,addRoom,deleteRoom,addStorage,deleteStorage,addContainer,deleteContainer,T}){
  const [nR,setNR]=useState({name:"",icon:"🏠"});
  const [nS,setNS]=useState({room_id:"",name:""});
  const [nC,setNC]=useState({storage_id:"",name:""});
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;
  const Sec=({title,children})=><div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}><div style={{fontSize:14,fontWeight:500,color:T.text,marginBottom:12}}>{title}</div>{children}</div>;
  const Row=({children})=><div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`0.5px solid ${T.border}`}}>{children}</div>;
  return(<div>
    <div style={{fontSize:16,fontWeight:500,color:T.text,marginBottom:14}}>🏗️ Rooms & Storage</div>
    <Sec title="Rooms">
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <input value={nR.icon} onChange={e=>setNR(p=>({...p,icon:e.target.value}))} style={{width:48,...iS(T)}}/>
        <input value={nR.name} onChange={e=>setNR(p=>({...p,name:e.target.value}))} placeholder="Room name" style={{flex:1,...iS(T)}}/>
        <Btn primary T={T} onClick={()=>{if(nR.name.trim()){addRoom(nR);setNR({name:"",icon:"🏠"});}}}>+ Add</Btn>
      </div>
      {rooms.map(r=><Row key={r.id}><span style={{color:T.text,flex:1}}>{r.icon} {r.name}</span><ActBtn danger T={T} onClick={()=>deleteRoom(r.id)}>Delete</ActBtn></Row>)}
    </Sec>
    <Sec title="Storage Units">
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <select value={nS.room_id} onChange={e=>setNS(p=>({...p,room_id:e.target.value}))} style={{flex:1,...iS(T)}}><option value="">Select room…</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}</select>
        <input value={nS.name} onChange={e=>setNS(p=>({...p,name:e.target.value}))} placeholder="Storage unit name" style={{flex:1,...iS(T)}}/>
        <Btn primary T={T} onClick={()=>{if(nS.name.trim()&&nS.room_id){addStorage(nS);setNS({room_id:"",name:""}); }}}>+ Add</Btn>
      </div>
      {storages.map(s=>{const r=rooms.find(x=>x.id===s.roomId);return<Row key={s.id}><span style={{color:T.text}}>🗄️ {s.name}</span><span style={{fontSize:11,color:T.textTer,flex:1}}> in {r?.icon} {r?.name}</span><ActBtn danger T={T} onClick={()=>deleteStorage(s.id)}>Delete</ActBtn></Row>;})}
    </Sec>
    <Sec title="Containers">
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <select value={nC.storage_id} onChange={e=>setNC(p=>({...p,storage_id:e.target.value}))} style={{flex:1,...iS(T)}}><option value="">Select storage unit…</option>{storages.map(s=>{const r=rooms.find(x=>x.id===s.roomId);return<option key={s.id} value={s.id}>{r?.icon} {r?.name} → {s.name}</option>;})}</select>
        <input value={nC.name} onChange={e=>setNC(p=>({...p,name:e.target.value}))} placeholder="Container name" style={{flex:1,...iS(T)}}/>
        <Btn primary T={T} onClick={()=>{if(nC.name.trim()&&nC.storage_id){addContainer(nC);setNC({storage_id:"",name:""});}}}> + Add</Btn>
      </div>
      {containers.map(c=>{const s=storages.find(x=>x.id===c.storageId);const r=rooms.find(x=>x.id===s?.roomId);return<Row key={c.id}><span style={{color:T.text}}>📁 {c.name}</span><span style={{fontSize:11,color:T.textTer,flex:1}}> in {s?.name} · {r?.icon} {r?.name}</span><ActBtn danger T={T} onClick={()=>deleteContainer(c.id)}>Delete</ActBtn></Row>;})}
    </Sec>
  </div>);
}

function UsersView({users,currentUserId,canAdmin,isSuperAdmin,houses,changeRole,T}){
  if(!canAdmin&&!isSuperAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Access denied</div>;
  const UT=({userList,editable})=>(
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:16}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:T.bgSec}}>{["Name","Role","Logins","Last Login",...(editable?["Change Role"]:[])].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontWeight:500,borderBottom:`0.5px solid ${T.border}`,color:T.textSec}}>{h}</th>)}</tr></thead>
        <tbody>{userList.map(u=>{const rc=ROLE_COLORS[u.role]||ROLE_COLORS.regular;return<tr key={u.id} style={{borderBottom:`0.5px solid ${T.border}`}}>
          <td style={{padding:"8px 12px",fontWeight:500,color:T.text}}>{u.name}{u.id===currentUserId?<span style={{fontSize:10,color:T.textTer}}> (you)</span>:""}</td>
          <td style={{padding:"8px 12px"}}><span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:rc.bg,color:rc.fg,fontWeight:500}}>{u.role}</span></td>
          <td style={{padding:"8px 12px",color:T.textSec}}>{u.loginCount}</td>
          <td style={{padding:"8px 12px",color:T.textTer}}>{u.lastLogin}</td>
          {editable&&<td style={{padding:"8px 12px"}}>{u.id!==currentUserId&&<select value={u.role} onChange={e=>changeRole(u.id,e.target.value)} style={{fontSize:12,padding:"2px 6px",height:28,border:`0.5px solid ${T.border}`,borderRadius:6,background:T.inputBg,color:T.text}}>{["admin","subadmin","regular","guest"].map(r=><option key={r} value={r}>{r}</option>)}</select>}</td>}
        </tr>;})}</tbody>
      </table>
    </div>
  );
  if(isSuperAdmin)return<div><div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>All Users</div>{houses.map(h=>{const hu=users.filter(u=>u.houseId===h.id);if(!hu.length)return null;return<div key={h.id} style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:500,color:T.textSec,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>🏠 {h.name} <span style={{background:T.bgTer,color:T.textSec,fontSize:11,padding:"1px 7px",borderRadius:10,fontWeight:400,textTransform:"none",letterSpacing:0}}>{hu.length} users</span></div><UT userList={hu} editable={false}/></div>;})}</div>;
  return<div><div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Users</div><UT userList={users.filter(u=>u.role!=="superadmin")} editable={true}/></div>;
}

function GroupsView({roomGroups,rooms,canAdmin,addGroup,deleteGroup,toggleGroupRoom,setGroupCols,showToast,allRooms,T}){
  const [newName,setNewName]=useState("");
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;
  const rt=allRooms||rooms;
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Room Groups</div>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New group name" style={{height:32,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"0 10px",fontSize:13,flex:1,background:T.inputBg,color:T.text}}/>
      <Btn primary T={T} onClick={()=>{if(newName.trim()){addGroup({name:newName.trim(),cols:2});setNewName("");}}}> + Add Group</Btn>
    </div>
    {roomGroups.map(g=><div key={g.id} style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:14,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
        <strong style={{flex:1,color:T.text}}>{g.name}</strong>
        <label style={{fontSize:12,color:T.textSec}}>Cols:</label>
        <input type="number" value={g.cols} min={1} max={4} onChange={e=>setGroupCols(g.id,parseInt(e.target.value)||2)} style={{width:50,height:28,border:`0.5px solid ${T.border}`,borderRadius:6,textAlign:"center",fontSize:13,background:T.inputBg,color:T.text}}/>
        <ActBtn danger T={T} onClick={()=>deleteGroup(g.id)}>Delete</ActBtn>
      </div>
      {rt.map(r=>{const inThis=g.roomIds.includes(r.id);const inOther=roomGroups.find(og=>og.id!==g.id&&og.roomIds.includes(r.id));
        return<label key={r.id} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",fontSize:13,cursor:inOther&&!inThis?"not-allowed":"pointer",opacity:inOther&&!inThis?.5:1,color:T.text}}>
          <input type="checkbox" checked={inThis} disabled={!!(inOther&&!inThis)} onChange={e=>toggleGroupRoom(g.id,r.id,e.target.checked)}/>
          {r.icon} {r.name}{inOther&&!inThis&&<span style={{fontSize:10,color:T.textTer}}>({inOther.name})</span>}
        </label>;
      })}
    </div>)}
  </div>);
}

function SuperAdminView({users,houses,rooms,items,storages,containers,moveLogs,lendLogs,isSuperAdmin,T}){
  if(!isSuperAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Super Admin only.</div>;
  const tL=users.reduce((a,u)=>a+u.loginCount,0);const lC=lendLogs.filter(l=>!l.returned).length;
  const stats=[["Houses",houses.length],["Rooms",rooms.length],["Items",items.length],["Users",users.length],["Total Logins",tL],["Lent Out",lC],["Storage Units",storages.length],["Containers",containers.length]];
  const mL=Math.max(...users.map(u=>u.loginCount),1);const mI=Math.max(...rooms.map(r=>items.filter(i=>i.roomId===r.id).length),1);
  const BR=({label,val,max})=>{const p=Math.round(val/max*100);return<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,fontSize:12}}><div style={{width:90,color:T.textSec,textAlign:"right",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div><div style={{flex:1,height:12,background:T.bgTer,borderRadius:6,overflow:"hidden"}}><div style={{width:p+"%",height:"100%",background:"#185FA5",borderRadius:6}}/></div><div style={{width:28,color:T.textSec,fontSize:11}}>{val}</div></div>;};
  const CC=({title,children})=><div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}><div style={{fontWeight:500,fontSize:13,marginBottom:10,color:T.text}}>{title}</div>{children}</div>;
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>📊 Platform Statistics</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:16}}>{stats.map(([l,v])=><div key={l} style={{background:T.bgSec,borderRadius:8,padding:12}}><div style={{fontSize:11,color:T.textSec,marginBottom:4}}>{l}</div><div style={{fontSize:22,fontWeight:500,color:T.text}}>{v}</div></div>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <CC title="Login Activity">{users.map(u=><BR key={u.id} label={u.name} val={u.loginCount} max={mL}/>)}</CC>
      <CC title="Items per Room">{rooms.map(r=>{const c=items.filter(i=>i.roomId===r.id).length;return<BR key={r.id} label={r.icon+" "+r.name} val={c} max={mI}/>;})}</CC>
      <CC title="Users by Role">{["superadmin","admin","subadmin","regular","guest"].map(role=>{const c=users.filter(u=>u.role===role).length;return c?<BR key={role} label={role} val={c} max={users.length}/>:null;})}</CC>
      <CC title="Recent Activity">{[...moveLogs].reverse().slice(0,8).map(l=>{const item=items.find(i=>i.id===l.itemId);return<div key={l.id} style={{fontSize:12,padding:"4px 0",borderBottom:`0.5px solid ${T.border}`,color:T.text}}><strong>{l.userId}</strong> moved {item?.name} <span style={{color:T.textTer}}>· {l.ts}</span></div>;})}</CC>
    </div>
  </div>);
}

function Modal({modal,setModal,rooms,storages,containers,tags,items,addItem,editItem,moveItem,lendItem,addTag,editTag,visibleRooms,showToast,T}){
  const close=()=>setModal(null);
  if(modal.type==="addItem"||modal.type==="editItem")return<ItemFormModal modal={modal} close={close} rooms={rooms} storages={storages} containers={containers} tags={tags} addItem={addItem} editItem={editItem} visibleRooms={visibleRooms} showToast={showToast} T={T}/>;
  if(modal.type==="move")return<MoveModal item={modal.item} close={close} rooms={rooms} storages={storages} containers={containers} visibleRooms={visibleRooms} moveItem={moveItem} showToast={showToast} T={T}/>;
  if(modal.type==="lend")return<LendModal item={modal.item} close={close} lendItem={lendItem} showToast={showToast} T={T}/>;
  if(modal.type==="addTag"||modal.type==="editTag")return<TagFormModal modal={modal} close={close} addTag={addTag} editTag={editTag} T={T}/>;
  return null;
}

function ItemFormModal({modal,close,rooms,storages,containers,tags,addItem,editItem,visibleRooms,showToast,T}){
  const ed=modal.type==="editItem";const item=modal.item;
  const [name,setName]=useState(ed?item.name:"");
  const [qty,setQty]=useState(ed?item.qty:1);
  const [unit,setUnit]=useState(ed?item.unit:"piece");
  const [consumable,setConsumable]=useState(ed?item.perishable:false);
  const [selTags,setSelTags]=useState(ed?item.tagIds:[]);
  const [selRoom,setSelRoom]=useState(modal.preRoom||(ed?item.roomId:""));
  const [selStorage,setSelStorage]=useState(modal.preStorage||(ed?item.storageId:""));
  const [selContainer,setSelContainer]=useState(modal.preContainer!==undefined?modal.preContainer:(ed?item.containerId:null));
  const [col,setCol]=useState(()=>Object.fromEntries(rooms.map(r=>[r.id,true])));
  const isPreset=!ed&&modal.preStorage;
  const toggleTag=(id)=>setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const save=()=>{
    if(!name.trim()){showToast("Name required");return;}if(!selStorage){showToast("Location required");return;}
    const data={name:name.trim(),qty:consumable?(parseFloat(qty)||0):1,unit:consumable?unit:"piece",perishable:consumable,tagIds:selTags,roomId:selRoom,storageId:selStorage,containerId:selContainer||null};
    if(ed)editItem(item.id,data);else addItem(data);close();
  };
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>{ed?"Edit Item":"Add Item"}</h2>
    <Field label="Item Name *" T={T}><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Rice, Screwdriver" style={iS(T)}/></Field>
    <Field label="Type" T={T}>
      <div style={{display:"flex",gap:0,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        <button onClick={()=>setConsumable(false)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",fontSize:13,fontWeight:!consumable?500:400,background:!consumable?T.text:T.bgSec,color:!consumable?T.bg:T.textSec}}>🔧 Asset</button>
        <button onClick={()=>setConsumable(true)} style={{flex:1,padding:"7px 0",border:"none",borderLeft:`0.5px solid ${T.border}`,cursor:"pointer",fontSize:13,fontWeight:consumable?500:400,background:consumable?T.text:T.bgSec,color:consumable?T.bg:T.textSec}}>📦 Consumable</button>
      </div>
    </Field>
    {consumable&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
      <Field label="Quantity *" T={T}><input type="number" value={qty} onChange={e=>setQty(e.target.value)} min={0} style={iS(T)}/></Field>
      <Field label="Unit" T={T}><select value={unit} onChange={e=>setUnit(e.target.value)} style={iS(T)}>{["piece","kg","g","litre","ml","box","pair","dozen"].map(u=><option key={u}>{u}</option>)}</select></Field>
    </div>}
    {isPreset?<Field label="Location (preset)" T={T}><div style={{padding:8,background:T.bgSec,borderRadius:8,fontSize:13,color:T.text}}>{rooms.find(r=>r.id===selRoom)?.name} › {storages.find(s=>s.id===selStorage)?.name}{selContainer?" › "+containers.find(c=>c.id===selContainer)?.name:""}</div></Field>:
    <Field label="Location *" T={T}>
      <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,padding:8,maxHeight:200,overflowY:"auto",background:T.inputBg}}>
        {visibleRooms.map(r=>{const rC=col[r.id];return<div key={r.id}>
          <div onClick={()=>setCol(p=>({...p,[r.id]:!p[r.id]}))} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",cursor:"pointer",borderRadius:6,fontSize:13,color:T.text}}><span style={{fontSize:11,width:12}}>{rC?"▸":"▾"}</span><span>{r.icon} {r.name}</span></div>
          {!rC&&storages.filter(s=>s.roomId===r.id).map(s=>{const sC=containers.filter(c=>c.storageId===s.id);return<div key={s.id} style={{paddingLeft:18}}>
            <div onClick={()=>{setSelRoom(r.id);setSelStorage(s.id);setSelContainer(null);}} style={{padding:"4px 8px",cursor:"pointer",borderRadius:6,fontSize:13,background:selStorage===s.id&&!selContainer?"#E6F1FB":"transparent",color:selStorage===s.id&&!selContainer?"#0C447C":T.text}}>🗄️ {s.name}</div>
            <div style={{paddingLeft:16}}>{sC.map(c=><div key={c.id} onClick={()=>{setSelRoom(r.id);setSelStorage(s.id);setSelContainer(c.id);}} style={{padding:"3px 8px",cursor:"pointer",borderRadius:6,fontSize:12,background:selContainer===c.id?"#E6F1FB":"transparent",color:selContainer===c.id?"#0C447C":T.text}}>📁 {c.name}</div>)}</div>
          </div>;})}
        </div>;})}
      </div>
      {selStorage&&<div style={{fontSize:11,color:T.textTer,marginTop:4}}>Selected: {rooms.find(r=>r.id===selRoom)?.name} › {storages.find(s=>s.id===selStorage)?.name}{selContainer?" › "+containers.find(c=>c.id===selContainer)?.name:" (no container)"}</div>}
    </Field>}
    <Field label="Tags" T={T}><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{tags.map(t=><span key={t.id} onClick={()=>toggleTag(t.id)} style={{fontSize:11,padding:"3px 9px",borderRadius:10,cursor:"pointer",background:t.bg,color:t.fg,outline:selTags.includes(t.id)?"2px solid #185FA5":"none",outlineOffset:1}}>{t.name}</span>)}</div></Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>{ed?"Save":"Add Item"}</Btn></div>
  </ModalWrap>);
}

function MoveModal({item,close,rooms,storages,containers,visibleRooms,moveItem,showToast,T}){
  const [reason,setReason]=useState("");const [sR,setSR]=useState(item.roomId);const [sS,setSS]=useState(item.storageId);const [sC,setSC]=useState(item.containerId);
  const [col,setCol]=useState(()=>Object.fromEntries(rooms.map(r=>[r.id,true])));
  const save=()=>{if(!reason.trim()){showToast("Reason required");return;}if(!sS){showToast("Select location");return;}moveItem(item.id,sR,sS,sC,reason);close();};
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Move: {item.name}</h2>
    <Field label="Reason *" T={T}><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Reorganizing" style={iS(T)}/></Field>
    <Field label="New Location *" T={T}>
      <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,padding:8,maxHeight:200,overflowY:"auto",background:T.inputBg}}>
        {visibleRooms.map(r=>{const rC=col[r.id];return<div key={r.id}>
          <div onClick={()=>setCol(p=>({...p,[r.id]:!p[r.id]}))} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",cursor:"pointer",fontSize:13,color:T.text}}><span style={{fontSize:11,width:12}}>{rC?"▸":"▾"}</span><span>{r.icon} {r.name}</span></div>
          {!rC&&storages.filter(s=>s.roomId===r.id).map(s=><div key={s.id} style={{paddingLeft:18}}>
            <div onClick={()=>{setSR(r.id);setSS(s.id);setSC(null);}} style={{padding:"4px 8px",cursor:"pointer",borderRadius:6,fontSize:13,background:sS===s.id&&!sC?"#E6F1FB":"transparent",color:sS===s.id&&!sC?"#0C447C":T.text}}>🗄️ {s.name}</div>
            <div style={{paddingLeft:16}}>{containers.filter(c=>c.storageId===s.id).map(c=><div key={c.id} onClick={()=>{setSR(r.id);setSS(s.id);setSC(c.id);}} style={{padding:"3px 8px",cursor:"pointer",borderRadius:6,fontSize:12,background:sC===c.id?"#E6F1FB":"transparent",color:sC===c.id?"#0C447C":T.text}}>📁 {c.name}</div>)}</div>
          </div>)}
        </div>;})}
      </div>
    </Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Move</Btn></div>
  </ModalWrap>);
}

function LendModal({item,close,lendItem,showToast,T}){
  const [borrower,setBorrower]=useState("");const [qty,setQty]=useState(1);
  const save=()=>{if(!borrower.trim()){showToast("Borrower name required");return;}if(item.perishable&&qty>item.qty){showToast("Not enough quantity");return;}lendItem(item.id,borrower.trim(),item.perishable?parseFloat(qty):1);close();};
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Lend: {item.name}</h2>
    <Field label="Borrower Name *" T={T}><input value={borrower} onChange={e=>setBorrower(e.target.value)} placeholder="Who is borrowing?" style={iS(T)}/></Field>
    {item.perishable&&<Field label={`Quantity to Lend (available: ${item.qty} ${item.unit})`} T={T}><input type="number" value={qty} onChange={e=>setQty(e.target.value)} min={1} max={item.qty} style={iS(T)}/></Field>}
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Lend</Btn></div>
  </ModalWrap>);
}

function TagFormModal({modal,close,addTag,editTag,T}){
  const ed=modal.type==="editTag";const t=modal.tag;
  const [name,setName]=useState(ed?t.name:"");const [bg,setBg]=useState(ed?t.bg:"#B5D4F4");
  const fg=autoFg(bg);
  const save=()=>{if(!name.trim())return;const tag={name,bg,fg};if(ed)editTag(t.id,tag);else addTag(tag);close();};
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>{ed?"Edit Tag":"Add Tag"}</h2>
    <Field label="Tag Name" T={T}><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Fragile" style={iS(T)}/></Field>
    <Field label="Colour" T={T}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <input type="color" value={bg} onChange={e=>setBg(e.target.value)} style={{width:48,height:40,border:"none",borderRadius:8,cursor:"pointer",padding:2,background:"none"}}/>
        <div><div style={{fontSize:12,color:T.textSec,marginBottom:4}}>Preview</div><span style={{fontSize:12,padding:"3px 10px",borderRadius:10,background:bg,color:fg}}>{name||"Tag name"}</span></div>
        <div style={{fontSize:11,color:T.textTer}}>Text colour is<br/>set automatically</div>
      </div>
    </Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Save</Btn></div>
  </ModalWrap>);
}

function ModalWrap({onClose,children,T}){return(<div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:16}}><div style={{background:T.cardBg,borderRadius:12,border:`0.5px solid ${T.border}`,padding:20,width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto"}}>{children}</div></div>);}
function Field({label,children,T}){return<div style={{marginBottom:12}}><label style={{display:"block",fontSize:12,color:T.textSec,marginBottom:4}}>{label}</label>{children}</div>;}
function Btn({children,primary,danger,onClick,T}){return<button onClick={onClick} style={{padding:"5px 14px",border:`0.5px solid ${primary?"#185FA5":danger?"#A32D2D":T.border}`,borderRadius:8,background:primary?"#185FA5":danger?"#A32D2D":T.bg,color:primary||danger?"#fff":T.text,cursor:"pointer",fontSize:13}}>{children}</button>;}
function ActBtn({children,danger,onClick,T}){return<button onClick={onClick} style={{fontSize:11,padding:"3px 8px",border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",background:T.bgSec,color:danger?"#A32D2D":T.text}}>{children}</button>;}
