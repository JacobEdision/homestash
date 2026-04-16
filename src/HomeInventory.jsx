
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// ─── MAPPERS ────────────────────────────────────────────────────────────────
const mapUser  = u => ({ ...u, houseId: u.house_id, loginCount: u.login_count, lastLogin: u.last_login });
const mapRoom  = r => ({ ...r, houseId: r.house_id });
const mapStorage = s => ({ ...s, roomId: s.room_id });
const mapContainer = c => ({ ...c, storageId: c.storage_id, parentContainerId: c.parent_container_id || null });
const mapItem  = i => ({ ...i, storageId: i.storage_id, containerId: i.container_id || null, roomId: i.room_id, tagIds: Array.isArray(i.tag_ids) ? i.tag_ids : [], perishable: Boolean(i.perishable), borrower: i.borrower || null });
const mapMoveLog  = l => ({ ...l, itemId: l.item_id, fromRoom: l.from_room, toRoom: l.to_room, userId: l.user_id });
const mapLendLog  = l => ({ ...l, itemId: l.item_id, userId: l.user_id, returned: Boolean(l.returned) });
const mapGroup    = g => ({ ...g, roomIds: Array.isArray(g.room_ids) ? g.room_ids : [] });
const mapGuestPerm = p => ({ ...p, userId: p.user_id, roomId: p.room_id || null, storageId: p.storage_id || null, containerId: p.container_id || null, blocked: Boolean(p.blocked) });
const itemToDb = i => ({ id: i.id, name: i.name, storage_id: i.storageId, container_id: i.containerId || null, room_id: i.roomId, qty: i.qty, unit: i.unit, perishable: i.perishable, tag_ids: i.tagIds, status: i.status, borrower: i.borrower || null });
const groupToDb = g => ({ id: g.id, name: g.name, room_ids: g.roomIds, cols: g.cols });
const containerToDb = c => ({ id: c.id, name: c.name, storage_id: c.storageId, parent_container_id: c.parentContainerId || null });

// ─── DB ─────────────────────────────────────────────────────────────────────
const db = {
  getAll:  async (t) => { const {data,error}=await supabase.from(t).select("*"); if(error){console.error(t,error);return[];} return data||[]; },
  upsert:  async (t,r) => { const {error}=await supabase.from(t).upsert(r); if(error)console.error(t,error); },
  insert:  async (t,r) => { const {error}=await supabase.from(t).insert(r); if(error)console.error(t,error); },
  update:  async (t,id,f) => { const {error}=await supabase.from(t).update(f).eq("id",id); if(error)console.error(t,error); },
  delete:  async (t,id) => { const {error}=await supabase.from(t).delete().eq("id",id); if(error)console.error(t,error); },
  deleteWhere: async (t,col,val) => { const {error}=await supabase.from(t).delete().eq(col,val); if(error)console.error(t,error); },
};

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const ROLE_COLORS = { superadmin:{bg:"#EEEDFE",fg:"#3C3489"},admin:{bg:"#E6F1FB",fg:"#0C447C"},subadmin:{bg:"#EAF3DE",fg:"#27500A"},regular:{bg:"#F1EFE8",fg:"#444441"},guest:{bg:"#FAEEDA",fg:"#633806"} };
const uid  = () => Math.random().toString(36).slice(2,9);
const now  = () => new Date().toISOString().slice(0,16).replace("T"," ");
const tsFilename = () => new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
const autoFg = hex => { const c=hex.replace("#",""); const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16); return (r*299+g*587+b*114)/1000>128?"#1a1a1a":"#ffffff"; };

const LIGHT={bg:"#fff",bgSec:"#f9f9f8",bgTer:"#f4f4f2",border:"#e5e5e5",borderSec:"#d0d0d0",text:"#111",textSec:"#555",textTer:"#888",sidebar:"#fff",header:"#fff",cardBg:"#fff",cardOos:"#f9f9f8",inputBg:"#f9f9f8",activeBg:"#f4f4f2"};
const DARK ={bg:"#1a1a1a",bgSec:"#242424",bgTer:"#2e2e2e",border:"#333",borderSec:"#444",text:"#f0f0f0",textSec:"#aaa",textTer:"#777",sidebar:"#1e1e1e",header:"#1e1e1e",cardBg:"#242424",cardOos:"#1e1e1e",inputBg:"#2e2e2e",activeBg:"#2e2e2e"};
const iS = T => ({width:"100%",height:34,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"0 10px",fontSize:13,background:T.inputBg,color:T.text,display:"block",boxSizing:"border-box"});

// ─── CONTAINER TREE HELPERS ─────────────────────────────────────────────────
// Get all containers (recursively) under a given container id
function getAllDescendantContainerIds(containerId, allContainers) {
  const direct = allContainers.filter(c => c.parentContainerId === containerId);
  return direct.flatMap(c => [c.id, ...getAllDescendantContainerIds(c.id, allContainers)]);
}
// Get all containers (recursively) under a given storage id (top level = no parent)
function getStorageContainerIds(storageId, allContainers) {
  const top = allContainers.filter(c => c.storageId === storageId && !c.parentContainerId);
  return top.flatMap(c => [c.id, ...getAllDescendantContainerIds(c.id, allContainers)]);
}
// Depth of nesting (0 = top level under storage)
function containerDepth(containerId, allContainers, depth=0) {
  const c = allContainers.find(x => x.id === containerId);
  if (!c || !c.parentContainerId) return depth;
  return containerDepth(c.parentContainerId, allContainers, depth+1);
}

// ─── AUTH SCREENS ───────────────────────────────────────────────────────────
// SUPERADMIN_EMAIL is the one account that gets superadmin role — set this to your email.
const SUPERADMIN_EMAIL = "jacob@homestash.app";

function AuthScreen({T,onAuth}){
  const [mode,setMode]=useState("login"); // login | register
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const submit=async()=>{
    setError(""); setLoading(true);
    try{
      if(mode==="register"){
        const {data,error:err}=await supabase.auth.signUp({email,password,options:{data:{name}}});
        if(err)throw err;
        // Create user row in our users table
        const isSA=email.toLowerCase()===SUPERADMIN_EMAIL.toLowerCase();
        const newUser={id:data.user.id,name:name||email.split("@")[0],role:isSA?"superadmin":"pending",house_id:null,login_count:0,last_login:new Date().toISOString().slice(0,10)};
        await db.upsert("users",newUser);
        onAuth(data.user);
      } else {
        const {data,error:err}=await supabase.auth.signInWithPassword({email,password});
        if(err)throw err;
        // Update login count
        await supabase.from("users").update({login_count:supabase.rpc("increment",{x:1}),last_login:new Date().toISOString().slice(0,10)}).eq("id",data.user.id);
        onAuth(data.user);
      }
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>🏠</div>
          <div style={{fontSize:24,fontWeight:600,color:T.text}}>HomeStash</div>
          <div style={{fontSize:14,color:T.textSec,marginTop:4}}>Your home inventory, organised</div>
        </div>
        <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:16,padding:28}}>
          <div style={{display:"flex",gap:0,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:20}}>
            <button onClick={()=>setMode("login")} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",fontSize:13,fontWeight:mode==="login"?600:400,background:mode==="login"?"#185FA5":T.bgSec,color:mode==="login"?"#fff":T.textSec}}>Sign In</button>
            <button onClick={()=>setMode("register")} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",fontSize:13,fontWeight:mode==="register"?600:400,background:mode==="register"?"#185FA5":T.bgSec,color:mode==="register"?"#fff":T.textSec}}>Create Account</button>
          </div>
          {mode==="register"&&<div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Your Name</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" style={{...iS(T)}}/>
          </div>}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com" onKeyDown={e=>e.key==="Enter"&&submit()} style={{...iS(T)}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Password</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()} style={{...iS(T)}}/>
          </div>
          {error&&<div style={{background:"#FEE2E2",border:"0.5px solid #FCA5A5",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#991B1B",marginBottom:14}}>{error}</div>}
          <button onClick={submit} disabled={loading} style={{width:"100%",padding:"10px 0",background:"#185FA5",color:"#fff",border:"none",borderRadius:8,fontSize:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}}>
            {loading?"Please wait…":mode==="login"?"Sign In":"Create Account"}
          </button>
          {mode==="register"&&<p style={{fontSize:11,color:T.textTer,textAlign:"center",marginTop:12}}>After creating your account, you'll choose to create a new house or join an existing one.</p>}
        </div>
      </div>
    </div>
  );
}

function HouseSetupScreen({T,currentUser,houses,onDone,showToast}){
  const [mode,setMode]=useState(null); // "create" | "join"
  const [houseName,setHouseName]=useState("");
  const [inviteCode,setInviteCode]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const createHouse=async()=>{
    if(!houseName.trim()){setError("Please enter a house name");return;}
    setLoading(true);setError("");
    try{
      const houseId="h"+uid();
      await db.upsert("houses",{id:houseId,name:houseName.trim(),address:""});
      await db.update("users",currentUser.id,{role:"admin",house_id:houseId});
      showToast("House created! Welcome to "+houseName);
      onDone();
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  const joinHouse=async()=>{
    if(!inviteCode.trim()){setError("Please enter your invite code");return;}
    setLoading(true);setError("");
    try{
      // Look up invite code in invites table
      const {data,error:err}=await supabase.from("invites").select("*").eq("code",inviteCode.trim().toUpperCase()).single();
      if(err||!data){setError("Invite code not found. Ask your house admin for a new one.");setLoading(false);return;}
      if(data.used){setError("This invite code has already been used.");setLoading(false);return;}
      // Join the house with the assigned role
      await db.update("users",currentUser.id,{role:data.role,house_id:data.house_id});
      await db.update("invites",data.id,{used:true,used_by:currentUser.id});
      showToast("Joined house successfully!");
      onDone();
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:440}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:36,marginBottom:6}}>🏠</div>
          <div style={{fontSize:20,fontWeight:600,color:T.text}}>Welcome, {currentUser.name}!</div>
          <div style={{fontSize:13,color:T.textSec,marginTop:4}}>To get started, create a new house or join an existing one.</div>
        </div>
        {!mode&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div onClick={()=>setMode("create")} style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:14,padding:24,textAlign:"center",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#185FA5"} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
            <div style={{fontSize:32,marginBottom:8}}>🏡</div>
            <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>Create a House</div>
            <div style={{fontSize:12,color:T.textSec}}>Start fresh. You'll be the Admin.</div>
          </div>
          <div onClick={()=>setMode("join")} style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:14,padding:24,textAlign:"center",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#185FA5"} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
            <div style={{fontSize:32,marginBottom:8}}>🔑</div>
            <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>Join a House</div>
            <div style={{fontSize:12,color:T.textSec}}>Use an invite code from your admin.</div>
          </div>
        </div>}
        {mode==="create"&&<div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:14,padding:24}}>
          <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:16}}>🏡 Name Your House</div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>House name</label>
            <input value={houseName} onChange={e=>setHouseName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createHouse()} placeholder="e.g. The Smith Family Home" style={{...iS(T)}}/>
          </div>
          {error&&<div style={{background:"#FEE2E2",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#991B1B",marginBottom:12}}>{error}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setMode(null);setError("");}} style={{flex:1,padding:"9px 0",background:T.bgSec,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,fontSize:13,cursor:"pointer"}}>Back</button>
            <button onClick={createHouse} disabled={loading} style={{flex:2,padding:"9px 0",background:"#185FA5",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>{loading?"Creating…":"Create House"}</button>
          </div>
        </div>}
        {mode==="join"&&<div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:14,padding:24}}>
          <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:16}}>🔑 Enter Invite Code</div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Invite code (ask your house admin)</label>
            <input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&joinHouse()} placeholder="e.g. ABC123" style={{...iS(T),textTransform:"uppercase",letterSpacing:2,textAlign:"center",fontSize:18}}/>
          </div>
          {error&&<div style={{background:"#FEE2E2",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#991B1B",marginBottom:12}}>{error}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setMode(null);setError("");}} style={{flex:1,padding:"9px 0",background:T.bgSec,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,fontSize:13,cursor:"pointer"}}>Back</button>
            <button onClick={joinHouse} disabled={loading} style={{flex:2,padding:"9px 0",background:"#185FA5",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>{loading?"Joining…":"Join House"}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}

// ─── APP ────────────────────────────────────────────────────────────────────
// SUPERADMIN_EMAIL is locked to jacob@homestash.app — only that account gets superadmin role.

export default function App() {
  const [authUser,setAuthUser]=useState(null);   // Supabase auth session user
  const [authLoading,setAuthLoading]=useState(true);
  const [users,setUsers]=useState([]); const [houses,setHouses]=useState([]); const [tags,setTags]=useState([]);
  const [roomGroups,setRoomGroups]=useState([]); const [rooms,setRooms]=useState([]); const [storages,setStorages]=useState([]);
  const [containers,setContainers]=useState([]); const [items,setItems]=useState([]); const [moveLogs,setMoveLogs]=useState([]);
  const [lendLogs,setLendLogs]=useState([]); const [guestPerms,setGuestPerms]=useState([]); const [loading,setLoading]=useState(true);
  const [view,setView]=useState("home"); const [roomId,setRoomId]=useState(null);
  const [filterConsumable,setFilterConsumable]=useState(null); const [search,setSearch]=useState("");
  const [modal,setModal]=useState(null); const [toast,setToast]=useState(null);
  const [darkMode,setDarkMode]=useState(false); const [showOos,setShowOos]=useState(false); const [sidebarOpen,setSidebarOpen]=useState(true);
  const T = darkMode ? DARK : LIGHT;

  // ── Listen for auth state changes ──
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setAuthUser(session?.user||null);
      setAuthLoading(false);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setAuthUser(session?.user||null);
    });
    return()=>subscription.unsubscribe();
  },[]);

  // ── Load data once authenticated — load users FIRST so houseId is known ──
  useEffect(()=>{
    if(!authUser)return;
    // Load users first so currentUser.houseId is available before rooms render
db.getAll("users").then(d=>setUsers(d.map(mapUser))).then(async ()=>{
      const meRes = await supabase.from("users").select("*").eq("id", authUser.id).single();
      const houseId = meRes?.data?.house_id || null;
      const isSA = meRes?.data?.role === "superadmin";

      const roomsRes = houseId && !isSA
        ? await supabase.from("rooms").select("*").eq("house_id", houseId)
        : await supabase.from("rooms").select("*");
      const fetchedRooms = (roomsRes.data || []).map(mapRoom);
      setRooms(fetchedRooms);
      const roomIds = fetchedRooms.map(r => r.id);

      const byRoom = async (table, mapper) => {
        if (isSA || !houseId) { const {data}=await supabase.from(table).select("*"); return (data||[]).map(mapper); }
        if (!roomIds.length) return [];
        const {data}=await supabase.from(table).select("*").in("room_id", roomIds);
        return (data||[]).map(mapper);
      };

      const fetchedStorages = await byRoom("storages", mapStorage);
      setStorages(fetchedStorages);
      const storageIds = fetchedStorages.map(s => s.id);

      const containersData = isSA || !houseId
        ? (await supabase.from("containers").select("*")).data || []
        : storageIds.length ? (await supabase.from("containers").select("*").in("storage_id", storageIds)).data || [] : [];
      setContainers(containersData.map(mapContainer));

      return Promise.all([
        db.getAll("houses").then(d=>setHouses(d)),
        supabase.from("tags").select("*").then(({data})=>setTags(data||[])),
        db.getAll("room_groups").then(d=>setRoomGroups(d.map(mapGroup))),
        byRoom("items", mapItem).then(d=>setItems(d)),
        byRoom("move_logs", mapMoveLog).then(d=>setMoveLogs(d)),
        db.getAll("lend_logs").then(d=>setLendLogs(d.map(mapLendLog))),
        db.getAll("guest_permissions").then(d=>setGuestPerms(d.map(mapGuestPerm))),
      ]);
    }).then(()=>setLoading(false)).catch(e=>{console.error(e);setLoading(false);});
  },[authUser]);

  const currentUser = users.find(u=>u.id===authUser?.id)||{id:"",name:"Loading…",role:"regular",houseId:null};
  const canEdit = ["admin","subadmin"].includes(currentUser.role);
  const canAdmin = currentUser.role==="admin";
  const isSuperAdmin = currentUser.role==="superadmin";
  const showToast = useCallback((msg)=>{setToast(msg);setTimeout(()=>setToast(null),2400);},[]);

  const signOut=async()=>{await supabase.auth.signOut();setUsers([]);setItems([]);setRooms([]);setStorages([]);setContainers([]);setHouses([]);setLoading(false);};

  // ── SuperAdmin mutations ──
  const deleteHouse=async(houseId)=>{
    // Cascade: delete all items, containers, storages, rooms, invites, users in this house
    const houseRooms=rooms.filter(r=>r.houseId===houseId).map(r=>r.id);
    const houseStorages=storages.filter(s=>houseRooms.includes(s.roomId)).map(s=>s.id);
    // items
    for(const sid of houseStorages) await db.deleteWhere("items","storage_id",sid);
    for(const rid of houseRooms) await db.deleteWhere("items","room_id",rid);
    // containers
    for(const sid of houseStorages) await db.deleteWhere("containers","storage_id",sid);
    // storages
    for(const rid of houseRooms) await db.deleteWhere("storages","room_id",rid);
    // rooms
    await db.deleteWhere("rooms","house_id",houseId);
    // invites
    await db.deleteWhere("invites","house_id",houseId);
    // reset users in this house to pending (don't delete their auth account)
    const houseUsers=users.filter(u=>u.houseId===houseId);
    for(const u of houseUsers) await db.update("users",u.id,{house_id:null,role:"pending"});
    // delete house
    await db.delete("houses",houseId);
    // refresh state
    setHouses(p=>p.filter(h=>h.id!==houseId));
    setRooms(p=>p.filter(r=>r.houseId!==houseId));
    setStorages(p=>p.filter(s=>!houseRooms.includes(s.roomId)));
    setItems(p=>p.filter(i=>!houseRooms.includes(i.roomId)));
    setUsers(p=>p.map(u=>u.houseId===houseId?{...u,houseId:null,role:"pending"}:u));
    showToast("House deleted");
  };
  const deleteUserRecord=async(userId)=>{
    // Remove from our users table (their Supabase auth account remains)
    await db.deleteWhere("guest_permissions","user_id",userId);
    await db.delete("users",userId);
    setUsers(p=>p.filter(u=>u.id!==userId));
    showToast("User removed from system");
  };

  // Guest visibility helpers
  const guestCanSeeRoom = useCallback((roomId) => {
    if (currentUser.role !== "guest") return true;
    return guestPerms.some(p => p.userId===currentUser.id && p.roomId===roomId && !p.blocked);
  }, [currentUser, guestPerms]);
  const guestCanSeeStorage = useCallback((storageId) => {
    if (currentUser.role !== "guest") return true;
    const blocked = guestPerms.some(p => p.userId===currentUser.id && p.storageId===storageId && p.blocked);
    return !blocked;
  }, [currentUser, guestPerms]);
  const guestCanSeeContainer = useCallback((containerId) => {
    if (currentUser.role !== "guest") return true;
    const blocked = guestPerms.some(p => p.userId===currentUser.id && p.containerId===containerId && p.blocked);
    return !blocked;
  }, [currentUser, guestPerms]);

  const visibleRooms = useMemo(()=>{
    if (currentUser.role==="guest") return rooms.filter(r => guestCanSeeRoom(r.id));
    if (currentUser.role==="superadmin") return rooms; // superadmin sees all
    if (!currentUser.houseId) return []; // still loading
    return rooms.filter(r=>r.houseId===currentUser.houseId);
  },[currentUser,guestPerms,rooms,guestCanSeeRoom]);

  const filteredItems = useCallback((list)=>{
    let r=list;
    if(filterConsumable!==null)r=r.filter(i=>i.perishable===filterConsumable);
    if(search){
      const q=search.toLowerCase();
      r=r.filter(i=>
        i.name.toLowerCase().includes(q)||
        (i.tagIds||[]).some(tid=>{const t=tags.find(x=>x.id===tid);return t&&t.name.toLowerCase().includes(q);})
      );
    }
    return r;
  },[filterConsumable,search,tags]);

  const oosItems = items.filter(i=>i.status==="out_of_stock"||(i.perishable&&i.qty===0));
  const nav=(v,rid=null)=>{setView(v);if(rid)setRoomId(rid);setSearch("");};

  // ── Item mutations ──
  const addItem=async(data)=>{const n={id:"i"+uid(),...data,status:"normal",borrower:null};await db.upsert("items",itemToDb(n));setItems(p=>[...p,n]);showToast("Item added!");};
  const editItem=async(id,data)=>{const u={...items.find(i=>i.id===id),...data};await db.upsert("items",itemToDb(u));setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item updated");};
  const deleteItem=async(id)=>{await db.delete("items",id);setItems(p=>p.filter(i=>i.id!==id));showToast("Item deleted");};
  const confirmDeleteItem=(id)=>{setModal({type:"confirmDelete",title:"Delete Item?",message:"This item will be permanently deleted.",onConfirm:()=>deleteItem(id)});};
  const markOos=async(id)=>{const item=items.find(i=>i.id===id);const ns=item.status==="out_of_stock"?"normal":"out_of_stock";await db.update("items",id,{status:ns});setItems(p=>p.map(i=>i.id===id?{...i,status:ns}:i));};
  const discardItem=async(id)=>{await db.update("items",id,{status:"discarded"});setItems(p=>p.map(i=>i.id===id?{...i,status:"discarded"}:i));showToast("Item moved to Discarded");};
  const restoreItem=async(id)=>{setModal({type:"restoreItem",itemId:id});};
  const moveItem=async(id,nR,nS,nC,reason)=>{const item=items.find(i=>i.id===id);const log={id:"ml"+uid(),item_id:id,from_room:item.roomId,to_room:nR,reason,user_id:authUser?.id,ts:now()};await db.insert("move_logs",log);const u={...item,roomId:nR,storageId:nS,containerId:nC};await db.upsert("items",itemToDb(u));setMoveLogs(p=>[...p,mapMoveLog(log)]);setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item moved!");};
  const lendItem=async(id,borrower,qty)=>{const item=items.find(i=>i.id===id);const log={id:"ll"+uid(),item_id:id,borrower,qty,user_id:authUser?.id,ts:now(),returned:false};await db.insert("lend_logs",log);const u={...item,status:"lent",borrower,qty:item.perishable?item.qty-qty:item.qty};await db.upsert("items",itemToDb(u));setLendLogs(p=>[...p,mapLendLog(log)]);setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item lent to "+borrower);};
  const returnItem=async(id)=>{const log=lendLogs.find(l=>l.itemId===id&&!l.returned);const item=items.find(i=>i.id===id);if(log)await db.update("lend_logs",log.id,{returned:true});const bq=(item.perishable&&log)?item.qty+log.qty:item.qty;const u={...item,status:"normal",borrower:null,qty:bq};await db.upsert("items",itemToDb(u));if(log)setLendLogs(p=>p.map(l=>l.id===log.id?{...l,returned:true}:l));setItems(p=>p.map(i=>i.id===id?u:i));showToast("Item returned");};

  // ── Tag mutations ──
  const addTag=async(t)=>{const n={id:"t"+uid(),...t};await db.upsert("tags",n);setTags(p=>[...p,n]);showToast("Tag added");};
  const editTag=async(id,t)=>{const u={...tags.find(x=>x.id===id),...t};await db.upsert("tags",u);setTags(p=>p.map(x=>x.id===id?u:x));showToast("Tag updated");};
  const deleteTag=async(id)=>{await db.delete("tags",id);setTags(p=>p.filter(x=>x.id!==id));setItems(p=>p.map(i=>({...i,tagIds:i.tagIds.filter(t=>t!==id)})));showToast("Tag deleted");};

  // ── User mutations ──
  const changeRole=async(id,role)=>{await db.update("users",id,{role});setUsers(p=>p.map(u=>u.id===id?{...u,role}:u));showToast("Role updated");};

  // ── Cascade delete helpers ──
  const cascadeDeleteContainer = async (cid) => {
    const descIds = getAllDescendantContainerIds(cid, containers);
    const allCids = [cid, ...descIds];
    // delete items in all containers
    for (const id of allCids) await db.deleteWhere("items","container_id",id);
    // delete containers bottom-up
    for (const id of [...allCids].reverse()) await db.delete("containers",id);
    setContainers(p=>p.filter(c=>!allCids.includes(c.id)));
    setItems(p=>p.filter(i=>!allCids.includes(i.containerId)));
  };
  const cascadeDeleteStorage = async (sid) => {
    const cids = getStorageContainerIds(sid, containers);
    for (const cid of cids) await db.deleteWhere("items","container_id",cid);
    await db.deleteWhere("items","storage_id",sid);
    for (const cid of [...cids].reverse()) await db.delete("containers",cid);
    await db.delete("storages",sid);
    setContainers(p=>p.filter(c=>!cids.includes(c.id)&&c.storageId!==sid));
    setItems(p=>p.filter(i=>i.storageId!==sid&&!cids.includes(i.containerId)));
    setStorages(p=>p.filter(s=>s.id!==sid));
  };
  const cascadeDeleteRoom = async (rid) => {
    const sids = storages.filter(s=>s.roomId===rid).map(s=>s.id);
    for (const sid of sids) await cascadeDeleteStorage(sid);
    await db.deleteWhere("items","room_id",rid);
    await db.delete("rooms",rid);
    setItems(p=>p.filter(i=>i.roomId!==rid));
    setRooms(p=>p.filter(r=>r.id!==rid));
  };
  const moveStorageToRoom = async (sid, newRoomId) => {
    await db.update("storages", sid, {room_id: newRoomId});
    setStorages(p=>p.map(s=>s.id===sid?{...s,roomId:newRoomId}:s));
    // also update all items in this storage
    const sItems = items.filter(i=>i.storageId===sid);
    for (const item of sItems) { const u={...item,roomId:newRoomId}; await db.upsert("items",itemToDb(u)); }
    setItems(p=>p.map(i=>i.storageId===sid?{...i,roomId:newRoomId}:i));
    showToast("Storage unit moved");
  };

  // ── Room / Storage / Container mutations ──
  const addRoom=async(r)=>{const hid=currentUser.houseId;if(!hid){showToast("Error: not linked to a house");return;}const n={id:"r"+uid(),house_id:hid,...r};await db.upsert("rooms",n);setRooms(p=>[...p,mapRoom(n)]);showToast("Room added");};
  const addStorage=async(s)=>{const n={id:"s"+uid(),...s};await db.upsert("storages",n);setStorages(p=>[...p,mapStorage(n)]);showToast("Storage unit added");};
  const addContainer=async(c)=>{const n={id:"c"+uid(),...c,parent_container_id:c.parent_container_id||null};await db.upsert("containers",n);setContainers(p=>[...p,mapContainer(n)]);showToast("Container added");};

  // ── Guest permissions ──
  const addGuestPerm=async(perm)=>{const n={id:uid(),...perm};await db.upsert("guest_permissions",n);setGuestPerms(p=>[...p,mapGuestPerm(n)]);};
  const removeGuestPerm=async(id)=>{await db.delete("guest_permissions",id);setGuestPerms(p=>p.filter(p=>p.id!==id));};

  // ── Group mutations ──
  const addGroup=async(g)=>{const n={id:"g"+uid(),...g,roomIds:[]};await db.upsert("room_groups",groupToDb(n));setRoomGroups(p=>[...p,n]);};
  const deleteGroup=async(id)=>{await db.delete("room_groups",id);setRoomGroups(p=>p.filter(g=>g.id!==id));};
  const toggleGroupRoom=async(gid,rid,checked)=>{if(checked){const a=roomGroups.find(g=>g.id!==gid&&g.roomIds.includes(rid));if(a){showToast(`Already in "${a.name}"`);return;}}const upd=roomGroups.map(g=>g.id!==gid?g:{...g,roomIds:checked?[...g.roomIds,rid]:g.roomIds.filter(x=>x!==rid)});await db.upsert("room_groups",groupToDb(upd.find(g=>g.id===gid)));setRoomGroups(upd);};
  const setGroupCols=async(gid,cols)=>{const upd=roomGroups.map(g=>g.id!==gid?g:{...g,cols});await db.upsert("room_groups",groupToDb(upd.find(g=>g.id===gid)));setRoomGroups(upd);};

  // ── Export CSV ──
  const exportCSV=()=>{
    const rows=items.map(i=>{const room=rooms.find(r=>r.id===i.roomId);const house=room?houses.find(h=>h.id===room.houseId):null;const storage=storages.find(s=>s.id===i.storageId);const container=i.containerId?containers.find(c=>c.id===i.containerId):null;
      return[house?.name,room?.name,storage?.name,container?.name||"",i.name,i.qty,i.unit,i.perishable?"Consumable":"Asset",i.status,i.borrower||"",i.tagIds.map(tid=>tags.find(t=>t.id===tid)?.name).filter(Boolean).join(";")].map(v=>`"${v}"`).join(",");});
    const csv=["House,Room,Storage,Container,Item,Qty,Unit,Type,Status,Borrower,Tags",...rows].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`inventory-${tsFilename()}.csv`;a.click();showToast("CSV exported!");
  };

  const sp={T,tags,rooms,storages,containers,items,canEdit,canAdmin,isSuperAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem:confirmDeleteItem,rawDeleteItem:deleteItem,returnItem,markOos,discardItem,restoreItem:restoreItem,nav,guestCanSeeStorage,guestCanSeeContainer};

  // ── Auth gates ──
  if(authLoading)return<div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",flexDirection:"column",gap:12}}><div style={{fontSize:36}}>🏠</div><div style={{fontSize:14,color:T.textSec}}>Loading…</div></div>;
  if(!authUser)return<AuthScreen T={T} onAuth={setAuthUser}/>;
  if(!loading&&currentUser.role==="pending")return<HouseSetupScreen T={T} currentUser={currentUser} houses={houses} showToast={showToast} onDone={()=>{setLoading(true);db.getAll("users").then(d=>{setUsers(d.map(mapUser));setLoading(false);}); }}/>;
  if(loading)return<div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",flexDirection:"column",gap:12}}><div style={{fontSize:36}}>🏠</div><div style={{fontSize:14,color:T.textSec}}>Loading your home…</div></div>;

  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"system-ui,sans-serif",fontSize:14,background:T.bg,color:T.text}}>
      {/* Sidebar */}
      <Sidebar view={view} nav={nav} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} currentUser={currentUser} lendLogs={lendLogs} filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} exportCSV={exportCSV} signOut={signOut} T={T} collapsed={!sidebarOpen}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <Header search={search} setSearch={setSearch} canEdit={canEdit} openAddItem={()=>setModal({type:"addItem"})} darkMode={darkMode} setDarkMode={setDarkMode} oosItems={oosItems} showOos={showOos} setShowOos={setShowOos} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} T={T} tags={tags} rooms={rooms} storages={storages} containers={containers} setModal={setModal} deleteItem={confirmDeleteItem} returnItem={returnItem} markOos={markOos} canAdmin={canAdmin}/>
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {view==="home"&&<HomeView {...sp} roomGroups={roomGroups} visibleRooms={visibleRooms} search={search} containers={containers}/>}
          {view==="room"&&<RoomView {...sp} roomId={roomId} addStorage={addStorage} addContainer={addContainer} addItem={addItem}/>}
          {view==="allitems"&&<AllItemsView {...sp}/>}
          {view==="discarded"&&<DiscardedView items={items.filter(i=>i.status==="discarded")} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={confirmDeleteItem} rawDeleteItem={deleteItem} restoreItem={(id)=>setModal({type:"restoreItem",itemId:id})} T={T}/>}
          {view==="lentout"&&<LentOutView items={items} lendLogs={lendLogs} rooms={rooms} returnItem={returnItem} T={T}/>}
          {view==="auditlog"&&<AuditLogView moveLogs={moveLogs} items={items} rooms={rooms} T={T}/>}
          {view==="tags"&&<TagsView tags={tags} canAdmin={canAdmin} setModal={setModal} deleteTag={deleteTag} T={T}/>}
          {view==="users"&&<UsersView users={users} currentUserId={authUser?.id} canAdmin={canAdmin} isSuperAdmin={isSuperAdmin} houses={houses} changeRole={changeRole} T={T} deleteUser={deleteUserRecord} setModal={setModal}/>}
          {view==="places"&&<PlacesView rooms={rooms} storages={storages} containers={containers} canAdmin={canAdmin} addRoom={addRoom} addStorage={addStorage} addContainer={addContainer} cascadeDeleteRoom={cascadeDeleteRoom} cascadeDeleteStorage={cascadeDeleteStorage} cascadeDeleteContainer={cascadeDeleteContainer} moveStorageToRoom={moveStorageToRoom} setModal={setModal} T={T} items={items}/>}
          {view==="invites"&&<InviteManager currentUser={currentUser} houses={houses} T={T} showToast={showToast}/> }
          {view==="guestperms"&&<GuestPermsView users={users} rooms={rooms} storages={storages} containers={containers} guestPerms={guestPerms} addGuestPerm={addGuestPerm} removeGuestPerm={removeGuestPerm} canAdmin={canAdmin} T={T}/>}
          {view==="groups"&&<GroupsView roomGroups={roomGroups} rooms={visibleRooms} canAdmin={canAdmin} addGroup={addGroup} deleteGroup={deleteGroup} toggleGroupRoom={toggleGroupRoom} setGroupCols={setGroupCols} showToast={showToast} allRooms={rooms} T={T}/>}
          {view==="superadmin"&&<SuperAdminView users={users} houses={houses} rooms={rooms} items={items} storages={storages} containers={containers} moveLogs={moveLogs} lendLogs={lendLogs} isSuperAdmin={isSuperAdmin} T={T} deleteHouse={deleteHouse} setModal={setModal}/>}
        </div>
      </div>
      {modal&&<Modal modal={modal} setModal={setModal} rooms={rooms} storages={storages} containers={containers} tags={tags} items={items} addItem={addItem} editItem={editItem} moveItem={moveItem} lendItem={lendItem} addTag={addTag} editTag={editTag} visibleRooms={visibleRooms} showToast={showToast} T={T}/>}
      {toast&&<div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"8px 18px",fontSize:13,zIndex:9999,color:T.text,boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>{toast}</div>}
    </div>
  );
}

// ─── SIDEBAR ────────────────────────────────────────────────────────────────
function Sidebar({view,nav,canAdmin,isSuperAdmin,currentUser,lendLogs,filterConsumable,setFilterConsumable,exportCSV,signOut,T,collapsed}){
  const lentCount=lendLogs.filter(l=>!l.returned).length;
  const rc=ROLE_COLORS[currentUser.role]||ROLE_COLORS.regular;

  // Icon-only strip when collapsed
  if(collapsed){
    const icons=isSuperAdmin
      ?[{v:"superadmin",icon:"📊"},{v:"users",icon:"👥"}]
      :[{v:"home",icon:"🏠"},{v:"allitems",icon:"📦"},{v:"discarded",icon:"🗑️"},{v:"lentout",icon:"🤝",badge:lentCount},{v:"auditlog",icon:"📋"},
        ...(canAdmin?[{v:"places",icon:"🏗️"},{v:"guestperms",icon:"🔐"},{v:"tags",icon:"🏷️"},{v:"users",icon:"👥"},{v:"groups",icon:"🗂️"},{v:"export",icon:"⬇️",action:exportCSV}]:[])];
    return(
      <div style={{width:52,background:T.sidebar,borderRight:`0.5px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0,alignItems:"center",paddingTop:8}}>
        {icons.map(({v,icon,badge,action})=>(
          <div key={v} onClick={()=>action?action():nav(v)} title={v} style={{position:"relative",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,cursor:"pointer",marginBottom:4,background:view===v?T.activeBg:"transparent",fontSize:18}}>
            {icon}
            {badge>0&&<span style={{position:"absolute",top:2,right:2,background:"#E6F1FB",color:"#0C447C",fontSize:9,fontWeight:700,padding:"1px 3px",borderRadius:8,minWidth:14,textAlign:"center"}}>{badge}</span>}
          </div>
        ))}
        <div style={{flex:1}}/>
        <div onClick={signOut} title={"Sign out "+currentUser.name} style={{width:32,height:32,borderRadius:"50%",background:"#E6F1FB",color:"#0C447C",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,cursor:"pointer",marginBottom:12}}>{currentUser.name.slice(0,2).toUpperCase()}</div>
      </div>
    );
  }

  const SI=({v,icon,label,badge})=>(
    <div onClick={()=>nav(v)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",cursor:"pointer",fontSize:13,color:view===v?T.text:T.textSec,fontWeight:view===v?500:400,background:view===v?T.activeBg:"transparent"}}>
      <span style={{fontSize:14,width:16,textAlign:"center"}}>{icon}</span><span style={{flex:1}}>{label}</span>
      {badge!==undefined&&badge>0&&<span style={{background:"#E6F1FB",color:"#0C447C",fontSize:10,padding:"1px 6px",borderRadius:10}}>{badge}</span>}
    </div>
  );
  const bottom=(<div style={{padding:"12px 16px",borderTop:`0.5px solid ${T.border}`,display:"flex",alignItems:"center",gap:8}}>
    <div onClick={signOut} title="Sign out" style={{width:28,height:28,borderRadius:"50%",background:"#E6F1FB",color:"#0C447C",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,cursor:"pointer",flexShrink:0}} title="Sign out">{currentUser.name.slice(0,2).toUpperCase()}</div>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.name}</div><span style={{fontSize:10,padding:"1px 6px",borderRadius:10,background:rc.bg,color:rc.fg,fontWeight:500}}>{currentUser.role}</span></div>
  </div>);

  if(isSuperAdmin)return(
    <div style={{width:220,background:T.sidebar,borderRight:`0.5px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"14px 16px 10px",fontWeight:500,fontSize:15,borderBottom:`0.5px solid ${T.border}`,color:T.text}}>🏠 HomeStash</div>
      <div style={{padding:"8px 16px 4px",fontSize:11,color:T.textTer,textTransform:"uppercase",letterSpacing:".07em",marginTop:4}}>Super Admin</div>
      <SI v="superadmin" icon="📊" label="Statistics"/><SI v="users" icon="👥" label="Users"/>
      <div style={{flex:1}}/>{bottom}
    </div>
  );
  return(
    <div style={{width:220,background:T.sidebar,borderRight:`0.5px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0,overflowY:"auto"}}>
      <div style={{padding:"14px 16px 10px",fontWeight:500,fontSize:15,borderBottom:`0.5px solid ${T.border}`,color:T.text,flexShrink:0}}>🏠 HomeStash</div>
      <SI v="home" icon="🏠" label="Rooms"/>
      <SI v="allitems" icon="📦" label="All Items"/>
      <div style={{padding:"3px 16px 3px 32px",fontSize:11,color:T.textTer}}>Filter by type</div>
      {[["· All",null],["📦 Consumable",true],["🔧 Asset",false]].map(([label,val])=>(
        <div key={label} onClick={()=>{setFilterConsumable(val);nav("allitems");}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 16px 5px 32px",cursor:"pointer",fontSize:12,color:filterConsumable===val?T.text:T.textSec,fontWeight:filterConsumable===val?500:400}}>{label}</div>
      ))}
      <SI v="discarded" icon="🗑️" label="Discarded"/>
      <SI v="lentout" icon="🤝" label="Lent Out" badge={lentCount}/>
      <SI v="auditlog" icon="📋" label="Audit Log"/>
      {canAdmin&&<>
        <div style={{padding:"8px 16px 4px",fontSize:11,color:T.textTer,textTransform:"uppercase",letterSpacing:".07em",marginTop:8}}>Admin</div>
        <SI v="places" icon="🏗️" label="Rooms & Storage"/>
        <SI v="invites" icon="🔑" label="Invite Members"/>
        <SI v="guestperms" icon="🔐" label="Guest Access"/>
        <SI v="tags" icon="🏷️" label="Manage Tags"/>
        <SI v="users" icon="👥" label="Users"/>
        <SI v="groups" icon="🗂️" label="Room Groups"/>
        <div onClick={exportCSV} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",cursor:"pointer",fontSize:13,color:T.textSec}}><span style={{fontSize:14,width:16}}>⬇️</span> Export CSV</div>
      </>}
      <div style={{flex:1}}/>{bottom}
    </div>
  );
}

// ─── HEADER ─────────────────────────────────────────────────────────────────
function Header({search,setSearch,canEdit,openAddItem,darkMode,setDarkMode,oosItems,showOos,setShowOos,sidebarOpen,setSidebarOpen,T,tags,rooms,storages,containers,setModal,deleteItem,returnItem,markOos,canAdmin}){
  const oosCount=oosItems.length;
  const ref=useRef();
  // Close dropdown when clicking outside
  useEffect(()=>{
    if(!showOos)return;
    const handler=(e)=>{if(ref.current&&!ref.current.contains(e.target))setShowOos(false);};
    document.addEventListener("mousedown",handler);
    return()=>document.removeEventListener("mousedown",handler);
  },[showOos,setShowOos]);
  return(
    <div style={{height:48,background:T.header,borderBottom:`0.5px solid ${T.border}`,display:"flex",alignItems:"center",padding:"0 12px",gap:10,flexShrink:0,position:"relative",zIndex:30}}>
      <div onClick={()=>setSidebarOpen(p=>!p)} title={sidebarOpen?"Collapse sidebar":"Expand sidebar"} style={{cursor:"pointer",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,fontSize:16,color:T.textSec,flexShrink:0}}>☰</div>
      <div style={{position:"relative",width:380}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items, rooms, tags…" style={{width:"100%",height:32,border:`0.5px solid ${T.borderSec}`,borderRadius:8,padding:"0 32px 0 10px",fontSize:13,background:T.inputBg,color:T.text}}/>
        {search&&<span onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:T.textTer,fontSize:15}}>✕</span>}
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
        {/* Bell with dropdown */}
        <div ref={ref} style={{position:"relative"}}>
          <div onClick={()=>setShowOos(p=>!p)} style={{position:"relative",cursor:"pointer",width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,background:showOos?T.activeBg:"transparent"}} title="Out of stock items">
            <span style={{fontSize:18}}>🔔</span>
            {oosCount>0&&<span style={{position:"absolute",top:2,right:2,background:"#E24B4A",color:"#fff",fontSize:9,fontWeight:700,padding:"1px 4px",borderRadius:10,minWidth:14,textAlign:"center"}}>{oosCount}</span>}
          </div>
          {showOos&&<div style={{position:"absolute",top:40,right:0,width:340,maxHeight:440,overflowY:"auto",background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,.2)",zIndex:100}}>
            <div style={{padding:"10px 14px",borderBottom:`0.5px solid ${T.border}`,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>🔔 Out of Stock</span>
              {oosCount>0&&<span style={{background:"#E24B4A",color:"#fff",fontSize:10,padding:"1px 6px",borderRadius:10}}>{oosCount}</span>}
              <div style={{marginLeft:"auto",cursor:"pointer",color:T.textTer,fontSize:14}} onClick={()=>setShowOos(false)}>✕</div>
            </div>
            {!oosCount
              ? <div style={{padding:"24px 14px",textAlign:"center",color:T.textSec,fontSize:13}}>✅ Everything is in stock</div>
              : oosItems.map(i=>{
                  const room=rooms.find(r=>r.id===i.roomId);
                  const storage=storages.find(s=>s.id===i.storageId);
                  const t=i.tagIds.map(tid=>tags.find(x=>x.id===tid)).filter(Boolean);
                  return(
                    <div key={i.id} style={{padding:"10px 14px",borderBottom:`0.5px solid ${T.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:1}}>{i.name}</div>
                        <div style={{fontSize:11,color:T.textSec}}>{room?.name} › {storage?.name}</div>
                        {t.length>0&&<div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>{t.map(tag=><span key={tag.id} style={{fontSize:9,padding:"1px 4px",borderRadius:6,background:tag.bg,color:tag.fg}}>{tag.name}</span>)}</div>}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                        {canEdit&&<button onClick={()=>markOos(i.id)} style={{fontSize:10,padding:"2px 7px",border:`0.5px solid ${T.border}`,borderRadius:5,cursor:"pointer",background:"#C0DD97",color:"#27500A",whiteSpace:"nowrap"}}>✓ Back in stock</button>}
                        {canEdit&&<button onClick={()=>{setModal({type:"move",item:i});setShowOos(false);}} style={{fontSize:10,padding:"2px 7px",border:`0.5px solid ${T.border}`,borderRadius:5,cursor:"pointer",background:T.bgSec,color:T.text}}>Move</button>}
                      </div>
                    </div>
                  );
                })
            }
          </div>}
        </div>
        <div onClick={()=>setDarkMode(p=>!p)} style={{cursor:"pointer",width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,fontSize:16}}>{darkMode?"☀️":"🌙"}</div>
        {canEdit&&<Btn primary onClick={openAddItem} T={T}>+ Add Item</Btn>}
      </div>
    </div>
  );
}

// ─── FILTER PILLS ───────────────────────────────────────────────────────────
function FilterPills({filterConsumable,setFilterConsumable,T}){
  const P=({val,label})=>(<span onClick={()=>setFilterConsumable(val)} style={{padding:"4px 10px",border:`0.5px solid ${T.borderSec}`,borderRadius:20,fontSize:12,cursor:"pointer",background:filterConsumable===val?T.text:T.bgTer,color:filterConsumable===val?T.bg:T.textSec}}>{label}</span>);
  return<div style={{display:"flex",gap:6,marginBottom:12}}><P val={null} label="All"/><P val={true} label="📦 Consumable"/><P val={false} label="🔧 Asset"/></div>;
}

// ─── HOME VIEW ──────────────────────────────────────────────────────────────
function HomeView({T,roomGroups,visibleRooms,canAdmin,nav,items,tags,storages,containers,search,filteredItems,canEdit,setModal,deleteItem,returnItem,markOos}){
  if(search){const found=filteredItems(items);return<div><div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Search Results <span style={{fontSize:13,fontWeight:400,color:T.textSec}}>({found.length} items)</span></div>{!found.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items match "{search}"</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>{found.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={visibleRooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} rawDeleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}</div>}</div>;}
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

// ─── ROOM VIEW ──────────────────────────────────────────────────────────────
function RoomView({T,roomId,rooms,storages,containers,items,tags,canEdit,canAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem,returnItem,markOos,nav,addStorage,addContainer,addItem,guestCanSeeStorage,guestCanSeeContainer}){
  const [collapsed,setCollapsed]=useState({});
  const [addStorageName,setAddStorageName]=useState("");
  const room=rooms.find(r=>r.id===roomId);
  if(!room)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Room not found</div>;
  const roomStorages=storages.filter(s=>s.roomId===roomId&&guestCanSeeStorage(s.id));

  return(<div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
      <span onClick={()=>nav("home")} style={{cursor:"pointer",color:T.textSec,fontSize:13}}>← Rooms</span>
      <span style={{color:T.textTer}}>/</span>
      <span style={{fontSize:16,fontWeight:500,color:T.text}}>{room.icon} {room.name}</span>
    </div>
    <FilterPills filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} T={T}/>

    {/* Add storage unit inline under room */}
    {canAdmin&&<div style={{display:"flex",gap:8,marginBottom:14}}>
      <input value={addStorageName} onChange={e=>setAddStorageName(e.target.value)} placeholder="New storage unit name…" style={{flex:1,...iS(T)}} onKeyDown={e=>{if(e.key==="Enter"&&addStorageName.trim()){addStorage({room_id:roomId,name:addStorageName});setAddStorageName("");}}}/>
      <Btn primary T={T} onClick={()=>{if(addStorageName.trim()){addStorage({room_id:roomId,name:addStorageName});setAddStorageName("");}}}>+ Add Storage</Btn>
    </div>}

    {roomStorages.map(s=>{
      const sContainers=containers.filter(c=>c.storageId===s.id&&!c.parentContainerId&&guestCanSeeContainer(c.id));
      const isC=collapsed[s.id];
      const directItems=filteredItems(items.filter(i=>i.storageId===s.id&&!i.containerId));
      return(<div key={s.id} style={{marginBottom:16}}>
        <div onClick={()=>setCollapsed(p=>({...p,[s.id]:!p[s.id]}))} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:500,flex:1,color:T.text}}>🗄️ {s.name}</span>
          {canEdit&&<span onClick={e=>{e.stopPropagation();setModal({type:"addItem",preRoom:roomId,preStorage:s.id,preContainer:null});}} style={{fontSize:11,padding:"3px 8px",border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",background:T.bg,color:T.text}}>+ Add Item</span>}
          <span style={{fontSize:11,color:T.textTer}}>{isC?"▸":"▾"}</span>
        </div>
        {!isC&&<>
          {(directItems.length>0||sContainers.length>0)?<div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            {/* Items on LEFT */}
            {directItems.length>0&&<div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:T.textTer,marginBottom:6}}>Items</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:8}}>
                {directItems.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} rawDeleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
              </div>
            </div>}
            {/* Containers on RIGHT */}
            {sContainers.length>0&&<div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:T.textTer,marginBottom:6}}>Containers</div>
              {sContainers.map(c=><ContainerTree key={c.id} container={c} allContainers={containers} items={items} tags={tags} rooms={rooms} storages={storages} filteredItems={filteredItems} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} addContainer={addContainer} roomId={roomId} storageId={s.id} depth={0} T={T} guestCanSeeContainer={guestCanSeeContainer}/>)}
            </div>}
          </div>:<div style={{fontSize:12,color:T.textTer,padding:"8px 4px"}}>Empty storage unit</div>}
          {canAdmin&&<div style={{marginTop:6}}><InlineAddContainer storageId={s.id} parentContainerId={null} addContainer={addContainer} T={T}/></div>}
        </>}
      </div>);
    })}
  </div>);
}

// ─── CONTAINER TREE (recursive, 3+ levels) ──────────────────────────────────
function ContainerTree({container,allContainers,items,tags,rooms,storages,filteredItems,canEdit,canAdmin,setModal,deleteItem,returnItem,markOos,addContainer,roomId,storageId,depth,T,guestCanSeeContainer}){
  const [open,setOpen]=useState(true);
  const cItems=filteredItems(items.filter(i=>i.containerId===container.id));
  const children=allContainers.filter(c=>c.parentContainerId===container.id&&guestCanSeeContainer(c.id));
  const canNest=depth<3; // allow up to 3 levels deep
  return(
    <div style={{marginBottom:8,marginLeft:depth>0?16:0,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",width:depth===0?"calc(50% - 6px)":undefined,display:"inline-block",verticalAlign:"top",boxSizing:"border-box",marginRight:depth===0?12:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:T.bgTer,cursor:"pointer"}} onClick={()=>setOpen(p=>!p)}>
        <span style={{fontSize:12,fontWeight:500,color:T.text,flex:1}}>{"📁".repeat(1)} {container.name}</span>
        <span style={{fontSize:11,color:T.textTer}}>{cItems.length} items</span>
        {canEdit&&<span onClick={e=>{e.stopPropagation();setModal({type:"addItem",preRoom:roomId,preStorage:storageId,preContainer:container.id});}} style={{fontSize:11,padding:"2px 6px",border:`0.5px solid ${T.border}`,borderRadius:5,cursor:"pointer",background:T.bg,color:T.text}}>+ Item</span>}
        <span style={{fontSize:10,color:T.textTer}}>{open?"▾":"▸"}</span>
      </div>
      {open&&<div style={{padding:"6px 8px"}}>
        {(cItems.length>0||children.length>0)?<div style={{display:"flex",gap:8}}>
          {/* Items on the LEFT */}
          {cItems.length>0&&<div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:T.textTer,marginBottom:4}}>Items</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:5}}>
              {cItems.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={allContainers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} rawDeleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T} compact/>)}
            </div>
          </div>}
          {/* Containers on the RIGHT */}
          {children.length>0&&<div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:T.textTer,marginBottom:4}}>Containers</div>
            {children.map(c=><ContainerTree key={c.id} container={c} allContainers={allContainers} items={items} tags={tags} rooms={rooms} storages={storages} filteredItems={filteredItems} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} returnItem={returnItem} markOos={markOos} addContainer={addContainer} roomId={roomId} storageId={storageId} depth={depth+1} T={T} guestCanSeeContainer={guestCanSeeContainer}/>)}
          </div>}
        </div>:<div style={{fontSize:11,color:T.textTer,padding:"4px 0"}}>Empty</div>}
        {canAdmin&&canNest&&<InlineAddContainer storageId={storageId} parentContainerId={container.id} addContainer={addContainer} T={T} small/>}
      </div>}
    </div>
  );
}

function InlineAddContainer({storageId,parentContainerId,addContainer,T,small}){
  const [name,setName]=useState("");
  const [show,setShow]=useState(false);
  const ref=useRef();
  useEffect(()=>{if(show&&ref.current)ref.current.focus();},[show]);
  if(!show)return<div onClick={()=>setShow(true)} style={{fontSize:11,color:T.textTer,cursor:"pointer",padding:"4px 0",display:"inline-block"}}>+ Add container</div>;
  return<div style={{display:"flex",gap:6,marginTop:6,marginBottom:4}}>
    <input ref={ref} value={name} onChange={e=>setName(e.target.value)} placeholder="Container name" onKeyDown={e=>{if(e.key==="Enter"&&name.trim()){addContainer({storage_id:storageId,parent_container_id:parentContainerId,name});setName("");setShow(false);}if(e.key==="Escape")setShow(false);}} style={{...iS(T),height:28,fontSize:12,flex:1}}/>
    <button onClick={()=>{if(name.trim()){addContainer({storage_id:storageId,parent_container_id:parentContainerId,name});setName("");setShow(false);}}} style={{padding:"0 10px",fontSize:12,background:"#185FA5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>Add</button>
    <button onClick={()=>setShow(false)} style={{padding:"0 8px",fontSize:12,background:T.bgTer,color:T.textSec,border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer"}}>✕</button>
  </div>;
}

// ─── ALL ITEMS ──────────────────────────────────────────────────────────────
function AllItemsView({T,items,tags,rooms,storages,containers,canEdit,canAdmin,filterConsumable,setFilterConsumable,filteredItems,setModal,deleteItem,returnItem,markOos}){
  const filtered=filteredItems(items);
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>All Items</div>
    <FilterPills filterConsumable={filterConsumable} setFilterConsumable={setFilterConsumable} T={T}/>
    {!filtered.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items found</div>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        {filtered.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} rawDeleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
      </div>}
  </div>);
}

// ─── ITEM CARD ──────────────────────────────────────────────────────────────
function ItemCard({item,tags,rooms,storages,containers,canEdit,canAdmin,setModal,deleteItem,rawDeleteItem,returnItem,markOos,discardItem,compact,T}){
  const oos=item.status==="out_of_stock"||(item.perishable&&item.qty===0);
  const lent=item.status==="lent";
  const room=rooms.find(r=>r.id===item.roomId);
  const storage=storages.find(s=>s.id===item.storageId);
  const container=item.containerId?containers.find(c=>c.id===item.containerId):null;
  return(<div style={{background:oos?T.cardOos:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:compact?8:12,padding:compact?8:12,position:"relative",opacity:oos?.65:1}}>
    {oos&&<span style={{position:"absolute",top:8,right:8,background:"#F7C1C1",color:"#791F1F",fontSize:9,padding:"1px 5px",borderRadius:10}}>Out of Stock</span>}
    {lent&&!oos&&<span style={{position:"absolute",top:8,right:8,background:"#FAC775",color:"#412402",fontSize:9,padding:"1px 5px",borderRadius:10}}>Lent</span>}
    <div style={{fontSize:compact?11:13,fontWeight:500,marginBottom:2,paddingRight:lent||oos?56:0,color:T.text}}>{item.name}</div>
    <div style={{fontSize:10,color:T.textSec,marginBottom:2}}>{room?.name} › {storage?.name}{container?" › "+container.name:""}</div>
    {item.perishable&&<div style={{fontSize:11,color:T.textSec}}>Qty: {item.qty} {item.unit}</div>}
    <div style={{fontSize:10,color:T.textTer}}>{item.perishable?"📦":"🔧"}</div>
    {item.tagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:4}}>{item.tagIds.map(tid=>{const t=tags.find(x=>x.id===tid);return t?<span key={tid} style={{fontSize:9,padding:"1px 4px",borderRadius:6,background:t.bg,color:t.fg}}>{t.name}</span>:null;})}</div>}
    {(canEdit||canAdmin)&&(<div style={{display:"flex",gap:3,marginTop:7,flexWrap:"wrap"}}>
      {canEdit&&<ActBtn onClick={()=>setModal({type:"move",item})} T={T}>Move</ActBtn>}
      {canEdit&&!lent&&<ActBtn onClick={()=>setModal({type:"lend",item})} T={T}>Lend</ActBtn>}
      {lent&&<ActBtn onClick={()=>returnItem(item.id)} T={T}>Return</ActBtn>}
      {canEdit&&markOos&&(item.perishable
        ?<ActBtn onClick={()=>markOos(item.id)} T={T}>{oos?"✓ In Stock":"Out of Stock"}</ActBtn>
        :<ActBtn onClick={()=>discardItem&&discardItem(item.id)} T={T}>Discard</ActBtn>
      )}
      {canEdit&&<ActBtn onClick={()=>setModal({type:"editItem",item})} T={T}>Edit</ActBtn>}
      {canAdmin&&<ActBtn danger onClick={()=>deleteItem(item.id)} T={T}>Del</ActBtn>}
    </div>)}
  </div>);
}

// ─── OOS PANEL ──────────────────────────────────────────────────────────────
function OosPanel({items,tags,rooms,storages,containers,canEdit,canAdmin,setModal,deleteItem,returnItem,markOos,T,onClose}){
  return(<div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
      <div style={{fontSize:16,fontWeight:500,color:T.text}}>🔔 Out of Stock</div>
      <span style={{background:"#E24B4A",color:"#fff",fontSize:11,padding:"2px 8px",borderRadius:10}}>{items.length}</span>
      <div style={{marginLeft:"auto"}}><Btn onClick={onClose} T={T}>✕ Close</Btn></div>
    </div>
    {!items.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No items are out of stock</div>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        {items.map(i=><ItemCard key={i.id} item={i} tags={tags} rooms={rooms} storages={storages} containers={containers} canEdit={canEdit} canAdmin={canAdmin} setModal={setModal} deleteItem={deleteItem} rawDeleteItem={deleteItem} returnItem={returnItem} markOos={markOos} T={T}/>)}
      </div>}
  </div>);
}

// ─── LENT OUT ───────────────────────────────────────────────────────────────
// ─── DISCARDED VIEW ─────────────────────────────────────────────────────────
function DiscardedView({items,tags,rooms,storages,containers,canEdit,canAdmin,setModal,deleteItem,rawDeleteItem,restoreItem,T}){
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:6,color:T.text}}>🗑️ Discarded Items</div>
    <div style={{fontSize:13,color:T.textSec,marginBottom:14}}>These items have been discarded and are inactive. You can restore them to an active location or permanently delete them.</div>
    {!items.length
      ?<div style={{color:T.textSec,textAlign:"center",padding:48,background:T.bgSec,borderRadius:12,border:`0.5px solid ${T.border}`}}>
        <div style={{fontSize:32,marginBottom:8}}>✅</div>
        <div style={{fontSize:14}}>No discarded items</div>
      </div>
      :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
        {items.map(i=>{
          const room=rooms.find(r=>r.id===i.roomId);
          const storage=storages.find(s=>s.id===i.storageId);
          const container=i.containerId?containers.find(c=>c.id===i.containerId):null;
          const itemTags=i.tagIds.map(tid=>tags.find(t=>t.id===tid)).filter(Boolean);
          return(
            <div key={i.id} style={{background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:12,padding:12,opacity:.75}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:T.text}}>{i.name}</div>
                  <div style={{fontSize:11,color:T.textSec,marginTop:1}}>Last location: {room?.name}{storage?" > "+storage.name:""}{container?" > "+container.name:""}</div>
                  <div style={{fontSize:10,color:T.textTer}}>Asset</div>
                </div>
                <span style={{fontSize:10,padding:"2px 6px",borderRadius:8,background:"#e0e0e0",color:"#555",flexShrink:0}}>Discarded</span>
              </div>
              {itemTags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>{itemTags.map(t=><span key={t.id} style={{fontSize:9,padding:"1px 5px",borderRadius:6,background:t.bg,color:t.fg}}>{t.name}</span>)}</div>}
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {canEdit&&<button onClick={()=>restoreItem(i.id)} style={{fontSize:11,padding:"4px 10px",background:"#185FA5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>Restore</button>}
                {canAdmin&&<button onClick={()=>deleteItem(i.id)} style={{fontSize:11,padding:"4px 10px",background:"#A32D2D",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>Delete forever</button>}
              </div>
            </div>
          );
        })}
      </div>}
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

// ─── AUDIT LOG ──────────────────────────────────────────────────────────────
function AuditLogView({moveLogs,items,rooms,T}){
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Audit / Move Log</div>
    {!moveLogs.length?<div style={{color:T.textSec,textAlign:"center",padding:32}}>No logs yet</div>:
      <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12}}>
        {[...moveLogs].reverse().map(l=>{const item=items.find(i=>i.id===l.itemId);const fR=rooms.find(r=>r.id===l.fromRoom);const tR=rooms.find(r=>r.id===l.toRoom);
          return<div key={l.id} style={{padding:"8px 14px",borderBottom:`0.5px solid ${T.border}`,fontSize:12}}>
            <div style={{color:T.text}}><strong>{item?.name||"Unknown"}</strong> {fR?.name||"?"} → {tR?.name||"?"}</div>
            <div style={{color:T.textSec}}>Reason: {l.reason} · By: {l.userId}</div>
            <div style={{color:T.textTer,fontSize:11}}>{l.ts}</div>
          </div>;
        })}
      </div>}
  </div>);
}

// ─── TAGS VIEW ──────────────────────────────────────────────────────────────
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

// ─── PLACES VIEW ────────────────────────────────────────────────────────────
// PlacesSec is defined at module level to prevent React from unmounting it on re-render.
// Defining components inside another component's render causes focus loss on every keystroke.
function PlacesSec({title,children,T}){
  return<div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,marginBottom:16,overflow:"hidden"}}>
    <div style={{padding:"12px 16px",borderBottom:`0.5px solid ${T.border}`,fontSize:14,fontWeight:600,color:T.text,background:T.bgSec}}>{title}</div>
    <div style={{padding:16}}>{children}</div>
  </div>;
}

// Each section is its own component so its state never triggers re-render of siblings
const ROOM_ICONS = ["🏠","🛋️","🍳","🛏️","🚿","📚","🔧","🏋️","🍽️","🎮","🧹","🌿","🚗","📦","🛁","🪴","🎨","💻","🧺","🪑"];

function RoomsSection({rooms,storages,containers,items,addRoom,cascadeDeleteRoom,setConfirmDel,T}){
  const [icon,setIcon]=useState("🏠");
  const [name,setName]=useState("");
  const [showIconPicker,setShowIconPicker]=useState(false);
  const submit=()=>{if(!name.trim())return;addRoom({icon,name});setName("");setIcon("🏠");setShowIconPicker(false);};
  const handleDel=(id)=>{
    const r=rooms.find(x=>x.id===id);const sCount=storages.filter(s=>s.roomId===id).length;
    const iCount=items.filter(i=>i.roomId===id).length;
    setConfirmDel({label:r?.name,detail:`${sCount} storage unit(s), all containers and ${iCount} item(s) will be permanently deleted.`,
      onConfirm:()=>cascadeDeleteRoom(id)});
  };
  return<PlacesSec title="🏠 Rooms" T={T}>
    <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
      {/* Icon picker button */}
      <div style={{position:"relative",flexShrink:0}}>
        <div onClick={()=>setShowIconPicker(p=>!p)} style={{width:42,height:34,border:`0.5px solid ${T.border}`,borderRadius:8,background:T.inputBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",userSelect:"none"}} title="Pick icon">{icon}</div>
        {showIconPicker&&<div style={{position:"absolute",top:40,left:0,zIndex:50,background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:10,padding:8,display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4,boxShadow:"0 4px 16px rgba(0,0,0,.18)",width:180}}>
          {ROOM_ICONS.map(ic=><div key={ic} onClick={()=>{setIcon(ic);setShowIconPicker(false);}} style={{fontSize:20,padding:4,borderRadius:6,cursor:"pointer",textAlign:"center",background:icon===ic?T.activeBg:"transparent"}}>{ic}</div>)}
        </div>}
      </div>
      {/* Room name - same width as storage unit input */}
      <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Room name…" style={{flex:1,...iS(T)}}/>
      <Btn primary T={T} onClick={submit}>+ Add Room</Btn>
    </div>
    {rooms.length===0&&<div style={{color:T.textTer,fontSize:13,textAlign:"center",padding:"12px 0"}}>No rooms yet</div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8,marginTop:8}}>
      {rooms.map(r=>{const sCnt=storages.filter(s=>s.roomId===r.id).length;const iCnt=items.filter(i=>i.roomId===r.id).length;return(
        <div key={r.id} style={{background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>{r.icon}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
            <div style={{fontSize:11,color:T.textTer}}>{sCnt} storage · {iCnt} items</div>
          </div>
          <ActBtn danger T={T} onClick={()=>handleDel(r.id)}>🗑</ActBtn>
        </div>
      );})}
    </div>
  </PlacesSec>;
}

function StoragesSection({rooms,storages,containers,items,addStorage,cascadeDeleteStorage,moveStorageToRoom,setConfirmDel,T}){
  const [roomId,setRoomId]=useState("");
  const [name,setName]=useState("");
  const submit=()=>{if(!name.trim()||!roomId)return;addStorage({room_id:roomId,name});setName("");};
  const handleDel=(id)=>{
    const s=storages.find(x=>x.id===id);const cCnt=containers.filter(c=>c.storageId===id).length;const iCnt=items.filter(i=>i.storageId===id).length;
    setConfirmDel({label:s?.name,detail:`${cCnt} container(s) and ${iCnt} item(s) will be permanently deleted.`,
      moveLabel:"Move to another room",onMove:()=>setConfirmDel({label:s?.name,detail:"Select a room to move this storage unit to:",isMoveRoom:true,storageId:id,rooms:rooms.filter(x=>x.id!==s.roomId),moveStorageToRoom}),
      onConfirm:()=>cascadeDeleteStorage(id)});
  };
  return<PlacesSec title="🗄️ Storage Units" T={T}>
    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
      <select value={roomId} onChange={e=>setRoomId(e.target.value)} style={{flex:1,...iS(T),minWidth:140}}>
        <option value="">Select room…</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
      </select>
      <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Storage unit name" style={{flex:2,...iS(T)}}/>
      <Btn primary T={T} onClick={submit}>+ Add</Btn>
    </div>
    {storages.length===0&&<div style={{color:T.textTer,fontSize:13,textAlign:"center",padding:"12px 0"}}>No storage units yet</div>}
    {rooms.map(r=>{const rStorages=storages.filter(s=>s.roomId===r.id);if(!rStorages.length)return null;return(
      <div key={r.id} style={{marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:500,color:T.textSec,marginBottom:6}}>{r.icon} {r.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {rStorages.map(s=>{const cCnt=containers.filter(c=>c.storageId===s.id).length;const iCnt=items.filter(i=>i.storageId===s.id).length;return(
            <div key={s.id} style={{background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"8px 12px",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:16}}>🗄️</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:T.text}}>{s.name}</div>
                <div style={{fontSize:11,color:T.textTer}}>{cCnt} containers · {iCnt} direct items</div>
              </div>
              <ActBtn danger T={T} onClick={()=>handleDel(s.id)}>🗑</ActBtn>
            </div>
          );})}
        </div>
      </div>
    );})}
  </PlacesSec>;
}

function ContainersSection({rooms,storages,containers,items,addContainer,cascadeDeleteContainer,setConfirmDel,T}){
  const [storageId,setStorageId]=useState("");
  const [parentId,setParentId]=useState("");
  const [name,setName]=useState("");
  const availableParents=containers.filter(c=>c.storageId===storageId);
  const submit=()=>{if(!name.trim()||!storageId)return;addContainer({storage_id:storageId,parent_container_id:parentId||null,name});setName("");};
  const handleDel=(id)=>{
    const c=containers.find(x=>x.id===id);const desc=getAllDescendantContainerIds(id,containers);
    setConfirmDel({label:c?.name,detail:`${desc.length} nested container(s) and all items inside will be permanently deleted.`,onConfirm:()=>cascadeDeleteContainer(id)});
  };
  // Render containers grouped by storage, indented by depth
  const renderTree=(parentId,storageId,depth)=>containers.filter(c=>c.storageId===storageId&&(c.parentContainerId||null)===(parentId||null)).map(c=>{
    const cCnt=items.filter(i=>i.containerId===c.id).length;
    return<div key={c.id}>
      <div style={{background:T.bgSec,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"7px 12px",display:"flex",alignItems:"center",gap:8,marginBottom:4,marginLeft:depth*20}}>
        <span>{"📁"}</span>
        <div style={{flex:1}}><div style={{fontSize:13,color:T.text}}>{c.name}</div><div style={{fontSize:11,color:T.textTer}}>{cCnt} items</div></div>
        <ActBtn danger T={T} onClick={()=>handleDel(c.id)}>🗑</ActBtn>
      </div>
      {renderTree(c.id,storageId,depth+1)}
    </div>;
  });
  return<PlacesSec title="📁 Containers" T={T}>
    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
      <select value={storageId} onChange={e=>{setStorageId(e.target.value);setParentId("");}} style={{flex:1,...iS(T),minWidth:140}}>
        <option value="">Select storage unit…</option>
        {rooms.map(r=>storages.filter(s=>s.roomId===r.id).map(s=><option key={s.id} value={s.id}>{r.icon} {r.name} → {s.name}</option>))}
      </select>
      <select value={parentId} onChange={e=>setParentId(e.target.value)} style={{flex:1,...iS(T),minWidth:140}}>
        <option value="">Top level (no parent)</option>
        {availableParents.map(c=><option key={c.id} value={c.id}>{"📁 "+c.name}</option>)}
      </select>
      <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Container name" style={{flex:2,...iS(T)}}/>
      <Btn primary T={T} onClick={submit}>+ Add</Btn>
    </div>
    {containers.length===0&&<div style={{color:T.textTer,fontSize:13,textAlign:"center",padding:"12px 0"}}>No containers yet</div>}
    {rooms.map(r=>storages.filter(s=>s.roomId===r.id).map(s=>{if(!containers.some(c=>c.storageId===s.id))return null;return(
      <div key={s.id} style={{marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:500,color:T.textSec,marginBottom:6}}>{r.icon} {r.name} › 🗄️ {s.name}</div>
        {renderTree(null,s.id,0)}
      </div>
    );}))}
  </PlacesSec>;
}

function PlacesView({rooms,storages,containers,canAdmin,addRoom,addStorage,addContainer,cascadeDeleteRoom,cascadeDeleteStorage,cascadeDeleteContainer,moveStorageToRoom,setModal,T,items}){
  const [confirmDel,setConfirmDel]=useState(null);
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;

  const handleConfirmDel=(conf)=>{
    if(conf.isMoveRoom){
      setModal({type:"moveStorageToRoom",storageId:conf.storageId,rooms:conf.rooms,moveStorageToRoom:conf.moveStorageToRoom,onDone:()=>setConfirmDel(null)});
      return;
    }
    conf.onConfirm();setConfirmDel(null);
  };

  return(<div>
    <div style={{fontSize:16,fontWeight:500,color:T.text,marginBottom:16}}>🏗️ Rooms & Storage</div>

    {confirmDel&&<div style={{background:"#FFF3CD",border:"1px solid #f0c000",borderRadius:10,padding:16,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:600,color:"#7A4F00",marginBottom:4}}>⚠️ Delete "{confirmDel.label}"?</div>
      <div style={{fontSize:12,color:"#5a4000",marginBottom:12}}>{confirmDel.detail}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {confirmDel.moveLabel&&<Btn T={T} onClick={()=>handleConfirmDel({...confirmDel,isMoveRoom:true})}>{confirmDel.moveLabel}</Btn>}
        <button onClick={()=>handleConfirmDel(confirmDel)} style={{padding:"5px 14px",background:"#A32D2D",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Delete everything</button>
        <Btn T={T} onClick={()=>setConfirmDel(null)}>Cancel</Btn>
      </div>
    </div>}

    <RoomsSection rooms={rooms} storages={storages} containers={containers} items={items} addRoom={addRoom} cascadeDeleteRoom={cascadeDeleteRoom} setConfirmDel={setConfirmDel} T={T}/>
    <StoragesSection rooms={rooms} storages={storages} containers={containers} items={items} addStorage={addStorage} cascadeDeleteStorage={cascadeDeleteStorage} moveStorageToRoom={moveStorageToRoom} setConfirmDel={setConfirmDel} T={T}/>
    <ContainersSection rooms={rooms} storages={storages} containers={containers} items={items} addContainer={addContainer} cascadeDeleteContainer={cascadeDeleteContainer} setConfirmDel={setConfirmDel} T={T}/>
  </div>);
}

// ─── GUEST PERMISSIONS VIEW ─────────────────────────────────────────────────
// ─── INVITE MANAGER ─────────────────────────────────────────────────────────
function InviteManager({currentUser,houses,T,showToast}){
  const [invites,setInvites]=useState([]);
  const [role,setRole]=useState("regular");
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    supabase.from("invites").select("*").eq("house_id",currentUser.houseId).order("created_at",{ascending:false})
      .then(({data})=>setInvites(data||[]));
  },[currentUser.houseId]);

  const generateCode=()=>{
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  };

  const createInvite=async()=>{
    setLoading(true);
    const code=generateCode();
    const inv={id:uid(),code,house_id:currentUser.houseId,role,created_by:currentUser.id,used:false};
    await supabase.from("invites").insert(inv);
    setInvites(p=>[{...inv,created_at:new Date().toISOString()},...p]);
    showToast(`Invite code created: ${code}`);
    setLoading(false);
  };

  const deleteInvite=async(id)=>{
    await supabase.from("invites").delete().eq("id",id);
    setInvites(p=>p.filter(i=>i.id!==id));
  };

  return(<div>
    <div style={{fontSize:16,fontWeight:500,color:T.text,marginBottom:14}}>🔑 Invite Members</div>
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:10}}>Generate a new invite code</div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <select value={role} onChange={e=>setRole(e.target.value)} style={{...iS(T),width:"auto",flex:1,minWidth:140}}>
          <option value="admin">Admin</option>
          <option value="subadmin">Sub Admin</option>
          <option value="regular">Regular</option>
          <option value="guest">Guest</option>
        </select>
        <Btn primary T={T} onClick={createInvite}>{loading?"Generating…":"+ Generate Code"}</Btn>
      </div>
      <div style={{fontSize:12,color:T.textTer,marginTop:8}}>Share the code with whoever you want to invite. Each code can only be used once.</div>
    </div>
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
      {!invites.length?<div style={{padding:20,textAlign:"center",color:T.textSec,fontSize:13}}>No invite codes yet</div>:
        invites.map(inv=>(
          <div key={inv.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:`0.5px solid ${T.border}`}}>
            <div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,letterSpacing:3,color:inv.used?T.textTer:T.text}}>{inv.code}</div>
            <div style={{flex:1}}>
              <span style={{fontSize:11,padding:"1px 6px",borderRadius:8,background:ROLE_COLORS[inv.role]?.bg||T.bgTer,color:ROLE_COLORS[inv.role]?.fg||T.text}}>{inv.role}</span>
              {inv.used&&<span style={{fontSize:11,color:T.textTer,marginLeft:6}}>Used</span>}
            </div>
            {!inv.used&&<button onClick={()=>{navigator.clipboard.writeText(inv.code);showToast("Code copied!");}} style={{fontSize:11,padding:"3px 8px",border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",background:T.bgSec,color:T.text}}>Copy</button>}
            <ActBtn danger T={T} onClick={()=>deleteInvite(inv.id)}>Delete</ActBtn>
          </div>
        ))
      }
    </div>
  </div>);
}

function GuestPermsView({users,rooms,storages,containers,guestPerms,addGuestPerm,removeGuestPerm,canAdmin,T}){
  const [selUser,setSelUser]=useState("");
  const [form,setForm]=useState({type:"room",roomId:"",storageId:"",containerId:"",blocked:false});
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;
  const guests=users.filter(u=>u.role==="guest");
  const userPerms=guestPerms.filter(p=>p.userId===selUser);

  const handleAdd=()=>{
    if(!selUser)return;
    const perm={user_id:selUser,blocked:form.blocked};
    if(form.type==="room")perm.room_id=form.roomId;
    else if(form.type==="storage")perm.storage_id=form.storageId;
    else perm.container_id=form.containerId;
    addGuestPerm(perm);
  };

  return(<div>
    <div style={{fontSize:16,fontWeight:500,color:T.text,marginBottom:14}}>🔐 Guest Access Control</div>
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:10}}>Select guest user</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {guests.map(u=><div key={u.id} onClick={()=>setSelUser(u.id)} style={{padding:"6px 14px",borderRadius:20,border:`0.5px solid ${T.border}`,cursor:"pointer",fontSize:13,background:selUser===u.id?"#185FA5":T.bgTer,color:selUser===u.id?"#fff":T.text}}>{u.name}</div>)}
        {!guests.length&&<div style={{color:T.textTer,fontSize:13}}>No guest users yet</div>}
      </div>
    </div>

    {selUser&&<>
      <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:10}}>Add permission / restriction</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {["room","storage","container"].map(t=><button key={t} onClick={()=>setForm(p=>({...p,type:t}))} style={{padding:"4px 12px",borderRadius:20,border:`0.5px solid ${T.border}`,cursor:"pointer",fontSize:12,background:form.type===t?"#185FA5":T.bgTer,color:form.type===t?"#fff":T.text}}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {form.type==="room"&&<select value={form.roomId} onChange={e=>setForm(p=>({...p,roomId:e.target.value}))} style={{flex:1,...iS(T)}}><option value="">Select room…</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}</select>}
          {form.type==="storage"&&<select value={form.storageId} onChange={e=>setForm(p=>({...p,storageId:e.target.value}))} style={{flex:1,...iS(T)}}><option value="">Select storage…</option>{storages.map(s=>{const r=rooms.find(x=>x.id===s.roomId);return<option key={s.id} value={s.id}>{r?.icon} {r?.name} → {s.name}</option>;})}</select>}
          {form.type==="container"&&<select value={form.containerId} onChange={e=>setForm(p=>({...p,containerId:e.target.value}))} style={{flex:1,...iS(T)}}><option value="">Select container…</option>{containers.map(c=>{const s=storages.find(x=>x.id===c.storageId);return<option key={c.id} value={c.id}>📁 {c.name} — {s?.name}</option>;})}</select>}
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:T.text,cursor:"pointer"}}>
            <input type="checkbox" checked={form.blocked} onChange={e=>setForm(p=>({...p,blocked:e.target.checked}))}/> Block access
          </label>
          <Btn primary T={T} onClick={handleAdd}>Add</Btn>
        </div>
        <div style={{fontSize:11,color:T.textTer,marginTop:8}}>Leave "Block access" unchecked to grant access. Check it to explicitly block.</div>
      </div>

      <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16}}>
        <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:10}}>Current permissions for {users.find(u=>u.id===selUser)?.name}</div>
        {!userPerms.length?<div style={{color:T.textTer,fontSize:13}}>No permissions set</div>:userPerms.map(p=>{
          const label=p.roomId?`🏠 Room: ${rooms.find(r=>r.id===p.roomId)?.name}`:p.storageId?`🗄️ Storage: ${storages.find(s=>s.id===p.storageId)?.name}`:p.containerId?`📁 Container: ${containers.find(c=>c.id===p.containerId)?.name}`:"Unknown";
          return<div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`0.5px solid ${T.border}`}}>
            <span style={{fontSize:12,color:T.text,flex:1}}>{label}</span>
            <span style={{fontSize:11,padding:"1px 6px",borderRadius:8,background:p.blocked?"#F7C1C1":"#C0DD97",color:p.blocked?"#791F1F":"#27500A"}}>{p.blocked?"Blocked":"Allowed"}</span>
            <ActBtn danger T={T} onClick={()=>removeGuestPerm(p.id)}>Remove</ActBtn>
          </div>;
        })}
      </div>
    </>}
  </div>);
}

// ─── USERS VIEW ─────────────────────────────────────────────────────────────
function UsersView({users,currentUserId,canAdmin,isSuperAdmin,houses,changeRole,deleteUser,setModal,T}){
  if(!canAdmin&&!isSuperAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Access denied</div>;

  const confirmDelete=(u)=>{
    setModal({type:"confirmDelete",title:"Remove user?",
      message:`This will remove ${u.name} from the system. Their login account is not deleted — they can re-register. This cannot be undone.`,
      onConfirm:()=>deleteUser(u.id)});
  };

  const UserTable=({userList,editable,showDelete})=>(
    <div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:16}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:T.bgSec}}>
          {["Name","Role","Logins","Last Login",...(editable?["Change Role"]:[]),...(showDelete?[""]:[])].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontWeight:500,borderBottom:`0.5px solid ${T.border}`,color:T.textSec}}>{h}</th>)}
        </tr></thead>
        <tbody>{userList.map(u=>{const rc=ROLE_COLORS[u.role]||ROLE_COLORS.regular;const isMe=u.id===currentUserId;return<tr key={u.id} style={{borderBottom:`0.5px solid ${T.border}`}}>
          <td style={{padding:"8px 12px",fontWeight:500,color:T.text}}>{u.name}{isMe&&<span style={{fontSize:10,color:T.textTer}}> (you)</span>}</td>
          <td style={{padding:"8px 12px"}}><span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:rc.bg,color:rc.fg,fontWeight:500}}>{u.role}</span></td>
          <td style={{padding:"8px 12px",color:T.textSec}}>{u.loginCount||0}</td>
          <td style={{padding:"8px 12px",color:T.textTer}}>{u.lastLogin||"—"}</td>
          {editable&&<td style={{padding:"8px 12px"}}>{!isMe&&<select value={u.role} onChange={e=>changeRole(u.id,e.target.value)} style={{fontSize:12,padding:"2px 6px",height:28,border:`0.5px solid ${T.border}`,borderRadius:6,background:T.inputBg,color:T.text}}>{["admin","subadmin","regular","guest"].map(r=><option key={r} value={r}>{r}</option>)}</select>}</td>}
          {showDelete&&<td style={{padding:"8px 12px"}}>{!isMe&&u.role!=="superadmin"&&<ActBtn danger T={T} onClick={()=>confirmDelete(u)}>Remove</ActBtn>}</td>}
        </tr>;})}</tbody>
      </table>
    </div>
  );

  if(isSuperAdmin){
    const noHouse=users.filter(u=>!u.houseId&&u.role!=="superadmin");
    return<div>
      <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>All Users</div>
      {houses.map(h=>{
        const hu=users.filter(u=>u.houseId===h.id);
        return<div key={h.id} style={{marginBottom:20}}>
          <div style={{fontSize:12,fontWeight:500,color:T.textSec,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>🏠 {h.name} <span style={{background:T.bgTer,color:T.textSec,fontSize:11,padding:"1px 7px",borderRadius:10,fontWeight:400,textTransform:"none",letterSpacing:0}}>{hu.length} users</span></div>
          <UserTable userList={hu} editable={false} showDelete={true}/>
        </div>;
      })}
      {noHouse.length>0&&<div style={{marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:500,color:T.textSec,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>⏳ Pending (no house yet) <span style={{background:T.bgTer,color:T.textSec,fontSize:11,padding:"1px 7px",borderRadius:10,fontWeight:400,textTransform:"none",letterSpacing:0}}>{noHouse.length}</span></div>
        <UserTable userList={noHouse} editable={false} showDelete={true}/>
      </div>}
    </div>;
  }
  return<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Users</div>
    <UserTable userList={users.filter(u=>u.role!=="superadmin")} editable={true} showDelete={false}/>
  </div>;
}

// ─── GROUPS VIEW ────────────────────────────────────────────────────────────
function GroupsView({roomGroups,rooms,canAdmin,addGroup,deleteGroup,toggleGroupRoom,setGroupCols,showToast,allRooms,T}){
  const [newName,setNewName]=useState("");
  if(!canAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Admin only</div>;
  const rt=allRooms||rooms;
  return(<div>
    <div style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Room Groups</div>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newName.trim()){addGroup({name:newName.trim(),cols:2});setNewName("");}}} placeholder="New group name" style={{height:32,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"0 10px",fontSize:13,flex:1,background:T.inputBg,color:T.text}}/>
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

// ─── SUPER ADMIN ────────────────────────────────────────────────────────────
function SuperAdminView({users,houses,rooms,items,storages,containers,moveLogs,lendLogs,isSuperAdmin,T,deleteHouse,setModal}){
  const [saTab,setSaTab]=useState("stats"); // stats | houses
  if(!isSuperAdmin)return<div style={{color:T.textSec,textAlign:"center",padding:32}}>Super Admin only.</div>;
  const tL=users.reduce((a,u)=>a+(u.loginCount||0),0);const lC=lendLogs.filter(l=>!l.returned).length;
  const stats=[["Houses",houses.length],["Rooms",rooms.length],["Items",items.length],["Users",users.length],["Total Logins",tL],["Lent Out",lC],["Storage Units",storages.length],["Containers",containers.length]];
  const mL=Math.max(...users.map(u=>u.loginCount||0),1);const mI=Math.max(...rooms.map(r=>items.filter(i=>i.roomId===r.id).length),1);
  const BR=({label,val,max})=>{const p=Math.round(val/max*100);return<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,fontSize:12}}><div style={{width:90,color:T.textSec,textAlign:"right",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div><div style={{flex:1,height:12,background:T.bgTer,borderRadius:6,overflow:"hidden"}}><div style={{width:p+"%",height:"100%",background:"#185FA5",borderRadius:6}}/></div><div style={{width:28,color:T.textSec,fontSize:11}}>{val}</div></div>;};
  const CC=({title,children})=><div style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}><div style={{fontWeight:500,fontSize:13,marginBottom:10,color:T.text}}>{title}</div>{children}</div>;

  const confirmDeleteHouse=(h)=>{
    const rCount=rooms.filter(r=>r.houseId===h.id).length;
    const uCount=users.filter(u=>u.houseId===h.id).length;
    const iCount=items.filter(i=>rooms.filter(r=>r.houseId===h.id).some(r=>r.id===i.roomId)).length;
    setModal({type:"confirmDelete",title:`Delete house "${h.name}"?`,
      message:`This will permanently delete ${rCount} rooms, ${iCount} items, and reset ${uCount} user(s) to pending status. This cannot be undone.`,
      onConfirm:()=>deleteHouse(h.id)});
  };

  return(<div>
    <div style={{display:"flex",gap:0,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:16,width:"fit-content"}}>
      <button onClick={()=>setSaTab("stats")} style={{padding:"7px 18px",border:"none",cursor:"pointer",fontSize:13,fontWeight:saTab==="stats"?600:400,background:saTab==="stats"?"#185FA5":T.bgSec,color:saTab==="stats"?"#fff":T.textSec}}>📊 Statistics</button>
      <button onClick={()=>setSaTab("houses")} style={{padding:"7px 18px",border:"none",cursor:"pointer",fontSize:13,fontWeight:saTab==="houses"?600:400,background:saTab==="houses"?"#185FA5":T.bgSec,color:saTab==="houses"?"#fff":T.textSec}}>🏠 Manage Houses</button>
    </div>

    {saTab==="stats"&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:16}}>{stats.map(([l,v])=><div key={l} style={{background:T.bgSec,borderRadius:8,padding:12}}><div style={{fontSize:11,color:T.textSec,marginBottom:4}}>{l}</div><div style={{fontSize:22,fontWeight:500,color:T.text}}>{v}</div></div>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <CC title="Login Activity">{users.map(u=><BR key={u.id} label={u.name} val={u.loginCount||0} max={mL}/>)}</CC>
        <CC title="Items per Room">{rooms.map(r=>{const c=items.filter(i=>i.roomId===r.id).length;return<BR key={r.id} label={(r.icon||"🏠")+" "+r.name} val={c} max={mI}/>;})}</CC>
        <CC title="Items per House">{houses.map(h=>{const hRooms=rooms.filter(r=>r.houseId===h.id);const c=items.filter(i=>hRooms.some(r=>r.id===i.roomId)).length;const mx=Math.max(...houses.map(hh=>{const hr=rooms.filter(r=>r.houseId===hh.id);return items.filter(i=>hr.some(r=>r.id===i.roomId)).length;}),1);return<BR key={h.id} label={"🏠 "+h.name} val={c} max={mx}/>;})}</CC>
        <CC title="Users by Role">{["superadmin","admin","subadmin","regular","guest","pending"].map(role=>{const c=users.filter(u=>u.role===role).length;return c?<BR key={role} label={role} val={c} max={users.length}/>:null;})}</CC>
      </div>
      <div style={{marginTop:14}}><CC title="Recent Activity">{[...moveLogs].reverse().slice(0,10).map(l=>{const item=items.find(i=>i.id===l.itemId);const u=users.find(x=>x.id===l.userId);return<div key={l.id} style={{fontSize:12,padding:"4px 0",borderBottom:`0.5px solid ${T.border}`,color:T.text}}><strong>{u?.name||l.userId}</strong> moved {item?.name} <span style={{color:T.textTer}}>· {l.ts}</span></div>;})}</CC></div>
    </>}

    {saTab==="houses"&&<>
      <div style={{fontSize:14,fontWeight:500,color:T.text,marginBottom:12}}>All Houses</div>
      {!houses.length&&<div style={{color:T.textSec,textAlign:"center",padding:32,background:T.bgSec,borderRadius:12}}>No houses yet</div>}
      {houses.map(h=>{
        const hRooms=rooms.filter(r=>r.houseId===h.id);
        const hUsers=users.filter(u=>u.houseId===h.id);
        const hItems=items.filter(i=>hRooms.some(r=>r.id===i.roomId));
        const admin=hUsers.find(u=>u.role==="admin");
        return<div key={h.id} style={{background:T.cardBg,border:`0.5px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:10,display:"flex",gap:16,alignItems:"center"}}>
          <div style={{fontSize:28}}>🏠</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:2}}>{h.name}</div>
            <div style={{fontSize:12,color:T.textSec}}>Admin: {admin?.name||"none"} · {hUsers.length} users · {hRooms.length} rooms · {hItems.length} items</div>
          </div>
          <button onClick={()=>confirmDeleteHouse(h)} style={{padding:"5px 14px",background:"#A32D2D",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:12}}>Delete House</button>
        </div>;
      })}
    </>}
  </div>);
}

// ─── MODAL ROUTER ───────────────────────────────────────────────────────────
function Modal({modal,setModal,rooms,storages,containers,tags,items,addItem,editItem,moveItem,lendItem,addTag,editTag,visibleRooms,showToast,T}){
  const close=()=>setModal(null);
  if(modal.type==="restoreItem")return<RestoreItemModal modal={modal} close={close} rooms={rooms} storages={storages} containers={containers} visibleRooms={visibleRooms} showToast={showToast} T={T} items={items} editItem={editItem}/>;
  if(modal.type==="confirmDelete")return(
    <ModalWrap onClose={close} T={T}>
      <h2 style={{fontSize:16,fontWeight:500,marginBottom:10,color:T.text}}>{modal.title||"Confirm Delete"}</h2>
      <div style={{fontSize:13,color:T.textSec,marginBottom:16}}>{modal.message}</div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        <Btn onClick={close} T={T}>Cancel</Btn>
        <button onClick={()=>{modal.onConfirm();close();}} style={{padding:"5px 14px",background:"#A32D2D",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Delete</button>
      </div>
    </ModalWrap>
  );
  if(modal.type==="addItem"||modal.type==="editItem")return<ItemFormModal modal={modal} close={close} rooms={rooms} storages={storages} containers={containers} tags={tags} addItem={addItem} editItem={editItem} visibleRooms={visibleRooms} showToast={showToast} T={T}/>;
  if(modal.type==="move")return<MoveModal item={modal.item} close={close} rooms={rooms} storages={storages} containers={containers} visibleRooms={visibleRooms} moveItem={moveItem} showToast={showToast} T={T}/>;
  if(modal.type==="lend")return<LendModal item={modal.item} close={close} lendItem={lendItem} showToast={showToast} T={T}/>;
  if(modal.type==="addTag"||modal.type==="editTag")return<TagFormModal modal={modal} close={close} addTag={addTag} editTag={editTag} T={T}/>;
  if(modal.type==="moveStorageToRoom")return<MoveStorageModal modal={modal} close={close} T={T}/>;
  return null;
}

// ─── LOCATION PICKER (shared by ItemFormModal and MoveModal) ─────────────────
// Simple two-dropdown approach: pick storage unit (grouped by room), then optionally a container
function LocationPicker({rooms,storages,containers,selRoom,selStorage,selContainer,setSelRoom,setSelStorage,setSelContainer,T}){
  const renderContainerOptions=(parentId,depth,storageId)=>
    containers.filter(c=>c.storageId===storageId&&(c.parentContainerId||null)===(parentId||null)).flatMap(c=>[
      <option key={c.id} value={c.id}>{"　".repeat(depth)}📁 {c.name}</option>,
      ...renderContainerOptions(c.id,depth+1,storageId)
    ]);

  const handleStorageChange=(sid)=>{
    if(!sid){setSelRoom("");setSelStorage("");setSelContainer(null);return;}
    const s=storages.find(x=>x.id===sid);
    setSelStorage(sid);
    setSelRoom(s?.roomId||"");
    setSelContainer(null);
  };

  const vr=rooms.length?rooms:[];
  const hasStorages=storages.length>0;

  if(!hasStorages){
    return<div style={{padding:"12px",background:T.bgSec,borderRadius:8,fontSize:13,color:T.textSec,textAlign:"center"}}>
      No storage units yet. Go to <strong>Rooms & Storage</strong> in the Admin menu to add some first.
    </div>;
  }

  return(<div>
    {/* Step 1: pick storage unit */}
    <div style={{marginBottom:8}}>
      <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Storage unit *</label>
      <select value={selStorage||""} onChange={e=>handleStorageChange(e.target.value)} style={iS(T)}>
        <option value="">— Select a storage unit —</option>
        {vr.map(r=>{
          const rStorages=storages.filter(s=>s.roomId===r.id);
          if(!rStorages.length)return null;
          return<optgroup key={r.id} label={(r.icon||"🏠")+" "+r.name}>
            {rStorages.map(s=><option key={s.id} value={s.id}>🗄️ {s.name}</option>)}
          </optgroup>;
        })}
      </select>
    </div>
    {/* Step 2: optionally pick a container inside that storage */}
    {selStorage&&<div style={{marginBottom:4}}>
      <label style={{fontSize:12,color:T.textSec,display:"block",marginBottom:4}}>Container (optional)</label>
      <select value={selContainer||""} onChange={e=>setSelContainer(e.target.value||null)} style={iS(T)}>
        <option value="">No container — store directly in storage unit</option>
        {renderContainerOptions(null,0,selStorage)}
      </select>
    </div>}
    {selStorage&&<div style={{fontSize:11,color:T.textTer,marginTop:4}}>
      📍 {rooms.find(r=>r.id===selRoom)?.name} › {storages.find(s=>s.id===selStorage)?.name}{selContainer?" › "+containers.find(c=>c.id===selContainer)?.name:""}
    </div>}
  </div>);
}

// ─── ITEM FORM MODAL ────────────────────────────────────────────────────────
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
  const isPreset=!ed&&modal.preStorage;
  const toggleTag=(id)=>setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const save=()=>{
    if(!name.trim()){showToast("Name required");return;}
    if(!selStorage){showToast("Please select a storage unit");return;}
    const data={name:name.trim(),qty:consumable?(parseFloat(qty)||0):1,unit:consumable?unit:"piece",perishable:consumable,tagIds:selTags,roomId:selRoom,storageId:selStorage,containerId:selContainer||null};
    if(ed)editItem(item.id,data);else addItem(data);close();
  };

  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>{ed?"Edit Item":"Add Item"}</h2>
    <Field label="Item Name *" T={T}><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Rice, Screwdriver" style={iS(T)}/></Field>
    <Field label="Type" T={T}>
      <div style={{display:"flex",border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        <button onClick={()=>setConsumable(false)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",fontSize:13,fontWeight:!consumable?500:400,background:!consumable?T.text:T.bgSec,color:!consumable?T.bg:T.textSec}}>🔧 Asset</button>
        <button onClick={()=>setConsumable(true)} style={{flex:1,padding:"7px 0",border:"none",borderLeft:`0.5px solid ${T.border}`,cursor:"pointer",fontSize:13,fontWeight:consumable?500:400,background:consumable?T.text:T.bgSec,color:consumable?T.bg:T.textSec}}>📦 Consumable</button>
      </div>
    </Field>
    {consumable&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
      <Field label="Quantity *" T={T}><input type="number" value={qty} onChange={e=>setQty(e.target.value)} min={0} style={iS(T)}/></Field>
      <Field label="Unit" T={T}><select value={unit} onChange={e=>setUnit(e.target.value)} style={iS(T)}>{["piece","kg","g","litre","ml","box","pair","dozen"].map(u=><option key={u}>{u}</option>)}</select></Field>
    </div>}
    {isPreset
      ?<Field label="Location" T={T}><div style={{padding:"10px 12px",background:T.bgSec,borderRadius:8,fontSize:13,color:T.text}}>📍 {rooms.find(r=>r.id===selRoom)?.name} › {storages.find(s=>s.id===selStorage)?.name}{selContainer?" › "+containers.find(c=>c.id===selContainer)?.name:""}</div></Field>
      :<Field label="Location *" T={T}>
        <LocationPicker rooms={visibleRooms} storages={storages} containers={containers} selRoom={selRoom} selStorage={selStorage} selContainer={selContainer} setSelRoom={setSelRoom} setSelStorage={setSelStorage} setSelContainer={setSelContainer} T={T}/>
      </Field>
    }
    <Field label="Tags" T={T}><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{tags.map(t=><span key={t.id} onClick={()=>toggleTag(t.id)} style={{fontSize:11,padding:"3px 9px",borderRadius:10,cursor:"pointer",background:t.bg,color:t.fg,outline:selTags.includes(t.id)?"2px solid #185FA5":"none",outlineOffset:1}}>{t.name}</span>)}</div></Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>{ed?"Save":"Add Item"}</Btn></div>
  </ModalWrap>);
}

// ─── MOVE MODAL ─────────────────────────────────────────────────────────────
function MoveModal({item,close,rooms,storages,containers,visibleRooms,moveItem,showToast,T}){
  const [reason,setReason]=useState("");
  const [sR,setSR]=useState(item.roomId);
  const [sS,setSS]=useState(item.storageId);
  const [sC,setSC]=useState(item.containerId);
  const save=()=>{if(!reason.trim()){showToast("Reason required");return;}if(!sS){showToast("Please select a location");return;}moveItem(item.id,sR,sS,sC,reason);close();};
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Move: {item.name}</h2>
    <Field label="Reason *" T={T}><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Reorganizing" style={iS(T)}/></Field>
    <Field label="New Location *" T={T}>
      <LocationPicker rooms={visibleRooms} storages={storages} containers={containers} selRoom={sR} selStorage={sS} selContainer={sC} setSelRoom={setSR} setSelStorage={setSS} setSelContainer={setSC} T={T}/>
    </Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Move</Btn></div>
  </ModalWrap>);
}

// ─── MOVE STORAGE TO ROOM MODAL ─────────────────────────────────────────────
// --- RESTORE ITEM MODAL ──────────────────────────────────────────────────────
function RestoreItemModal({modal,close,rooms,storages,containers,visibleRooms,showToast,T,items,editItem}){
  const item=items.find(i=>i.id===modal.itemId);
  const [selRoom,setSelRoom]=useState("");
  const [selStorage,setSelStorage]=useState("");
  const [selContainer,setSelContainer]=useState(null);
  const save=async()=>{
    if(!selStorage){showToast("Please select a location");return;}
    await editItem(item.id,{...item,status:"normal",roomId:selRoom,storageId:selStorage,containerId:selContainer||null});
    showToast("Item restored!");
    close();
  };
  if(!item)return null;
  const vr=visibleRooms||rooms;
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:6,color:T.text}}>Restore: {item.name}</h2>
    <p style={{fontSize:13,color:T.textSec,marginBottom:14}}>Choose where to store this item:</p>
    <Field label="Location *" T={T}>
      <LocationPicker rooms={vr} storages={storages} containers={containers} selRoom={selRoom} selStorage={selStorage} selContainer={selContainer} setSelRoom={setSelRoom} setSelStorage={setSelStorage} setSelContainer={setSelContainer} T={T}/>
    </Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Restore Item</Btn></div>
  </ModalWrap>);
}

function MoveStorageModal({modal,close,T}){
  const [selRoom,setSelRoom]=useState("");
  const save=()=>{if(!selRoom)return;modal.moveStorageToRoom(modal.storageId,selRoom);if(modal.onDone)modal.onDone();close();};
  return(<ModalWrap onClose={close} T={T}>
    <h2 style={{fontSize:16,fontWeight:500,marginBottom:14,color:T.text}}>Move Storage Unit</h2>
    <p style={{fontSize:13,color:T.textSec,marginBottom:14}}>Select a room to move this storage unit and all its contents to:</p>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
      {modal.rooms.map(r=><div key={r.id} onClick={()=>setSelRoom(r.id)} style={{padding:"10px 14px",borderRadius:8,border:`1.5px solid ${selRoom===r.id?"#185FA5":T.border}`,cursor:"pointer",background:selRoom===r.id?"#E6F1FB":T.cardBg,color:selRoom===r.id?"#0C447C":T.text,fontSize:13,fontWeight:selRoom===r.id?500:400}}>{r.icon} {r.name}</div>)}
    </div>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Move Here</Btn></div>
  </ModalWrap>);
}

// ─── LEND MODAL ─────────────────────────────────────────────────────────────
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

// ─── TAG FORM MODAL ─────────────────────────────────────────────────────────
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
        <input type="color" value={bg} onChange={e=>setBg(e.target.value)} style={{width:48,height:40,border:"none",borderRadius:8,cursor:"pointer",padding:2}}/>
        <div><div style={{fontSize:12,color:T.textSec,marginBottom:4}}>Preview</div><span style={{fontSize:12,padding:"3px 10px",borderRadius:10,background:bg,color:fg}}>{name||"Tag name"}</span></div>
        <div style={{fontSize:11,color:T.textTer}}>Text colour<br/>auto-selected</div>
      </div>
    </Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><Btn onClick={close} T={T}>Cancel</Btn><Btn primary onClick={save} T={T}>Save</Btn></div>
  </ModalWrap>);
}

// ─── PRIMITIVES ─────────────────────────────────────────────────────────────
function ModalWrap({onClose,children,T}){return<div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:16}}><div style={{background:T.cardBg,borderRadius:12,border:`0.5px solid ${T.border}`,padding:20,width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto"}}>{children}</div></div>;}
function Field({label,children,T}){return<div style={{marginBottom:12}}><label style={{display:"block",fontSize:12,color:T.textSec,marginBottom:4}}>{label}</label>{children}</div>;}
function Btn({children,primary,danger,onClick,T}){return<button onClick={onClick} style={{padding:"5px 14px",border:`0.5px solid ${primary?"#185FA5":danger?"#A32D2D":T.border}`,borderRadius:8,background:primary?"#185FA5":danger?"#A32D2D":T.bg,color:primary||danger?"#fff":T.text,cursor:"pointer",fontSize:13}}>{children}</button>;}
function ActBtn({children,danger,onClick,T}){return<button onClick={onClick} style={{fontSize:11,padding:"3px 8px",border:`0.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",background:T.bgSec,color:danger?"#A32D2D":T.text}}>{children}</button>;}
