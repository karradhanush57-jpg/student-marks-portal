const express=require("express");
const path=require("path"),fs=require("fs"),bcrypt=require("bcryptjs");
const multer=require("multer"),XLSX=require("xlsx");
const rateLimit=require("express-rate-limit"),helmet=require("helmet"),session=require("express-session");

const app=express(),PORT=process.env.PORT||3000;
const dataDir=path.join(__dirname,"data");fs.mkdirSync(path.join(dataDir,"uploads"),{recursive:true});
const dbFile=path.join(dataDir,"data.json");
const emptyDb={students:[],marks:[],admins:[],import_logs:[],audit_logs:[],seq:{student:1,mark:1,admin:1,import:1,audit:1}};
let db;
try{db=JSON.parse(fs.readFileSync(dbFile,"utf8"));}catch{db=emptyDb;save();}
function save(){fs.writeFileSync(dbFile,JSON.stringify(db,null,2));}
function next(k){const n=db.seq[k]||1;db.seq[k]=n+1;return n;}
if(!db.admins.some(a=>a.email==="admin@example.com")){
 db.admins.push({id:next("admin"),email:"admin@example.com",password_hash:bcrypt.hashSync("admin123",10)});save();
}

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"3mb"}));app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"CHANGE_ME",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:false}}));
app.use(express.static(path.join(__dirname,"public")));
const lookupLimit=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});
const upload=multer({dest:path.join(dataDir,"uploads"),limits:{fileSize:10*1024*1024}});
const norm=v=>String(v??"").trim(), roll=v=>norm(v).toUpperCase();
function auth(req,res,next){if(!req.session.adminId)return res.status(401).json({error:"Admin login required."});next()}
function audit(action,details){db.audit_logs.unshift({id:next("audit"),action,details,created_at:new Date().toISOString()});save()}
function alias(row,list){const keys=Object.keys(row);for(const a of list){const k=keys.find(x=>norm(x).toLowerCase()===a.toLowerCase());if(k!==undefined)return row[k]}const k=keys.find(x=>list.some(a=>norm(x).toLowerCase().includes(a.toLowerCase())));return k===undefined?"":row[k]}
function parse(rows){const good=[],bad=[];rows.forEach((r,i)=>{const x={roll:roll(alias(r,["roll no","roll number","roll","id"])),name:norm(alias(r,["name","student name"])),subject:norm(alias(r,["subject","subject name"])),mid1:norm(alias(r,["midterm 1","mid 1","mid1"])),mid2:norm(alias(r,["midterm 2","mid 2","mid2"])),assignment:norm(alias(r,["assignment","internal","assignment/internal"])),semester_mark:norm(alias(r,["semester","final","semester/final"])),total:norm(alias(r,["total","total marks"])),grade:norm(alias(r,["grade"])),result:norm(alias(r,["result","status"])),class_name:norm(alias(r,["class","class name","course"])),semester:norm(alias(r,["semester name","sem"]))};if(!x.roll||!x.name||!x.subject)bad.push({row:i+2,reason:"Roll Number, Name and Subject are required."});else if(![x.mid1,x.mid2,x.assignment,x.semester_mark,x.total,x.grade,x.result].some(Boolean))bad.push({row:i+2,reason:"At least one mark/result field is required."});else good.push(x)});return{good,bad}}
function importRows(rows,file){const p=parse(rows),seen=new Set(),dupes=[];p.good.forEach(x=>{const k=x.roll+"|"+x.subject;if(seen.has(k))dupes.push({roll:x.roll,subject:x.subject});seen.add(k)});for(const x of p.good){let s=db.students.find(v=>v.roll===x.roll);if(s){s.name=x.name;s.class_name=x.class_name;s.semester=x.semester;s.updated_at=new Date().toISOString()}else db.students.push({roll:x.roll,name:x.name,class_name:x.class_name,semester:x.semester,published:1,updated_at:new Date().toISOString()});let m=db.marks.find(v=>v.roll===x.roll&&v.subject===x.subject);const vals={roll:x.roll,subject:x.subject,mid1:x.mid1,mid2:x.mid2,assignment:x.assignment,semester_mark:x.semester_mark,total:x.total,grade:x.grade,result:x.result,published:1};if(m)Object.assign(m,vals);else db.marks.push({id:next("mark"),...vals})}db.import_logs.unshift({id:next("import"),filename:file,rows:rows.length,valid_rows:p.good.length,invalid_rows:p.bad.length+dupes.length,created_at:new Date().toISOString()});save();audit("IMPORT",`${file}: ${p.good.length} valid rows`);return{...p,dupes}}

app.get("/api/marks/:r",lookupLimit,(req,res)=>{const r=roll(req.params.r);if(!r)return res.status(400).json({error:"Enter a roll number."});const s=db.students.find(v=>v.roll===r&&v.published===1);if(!s)return res.status(404).json({error:"No published student record was found."});const m=db.marks.filter(v=>v.roll===r&&v.published===1).sort((a,b)=>a.subject.localeCompare(b.subject)).map(({subject,mid1,mid2,assignment,semester_mark,total,grade,result})=>({subject,mid1,mid2,assignment,semester_mark,total,grade,result}));res.json({student:s,marks:m})});
app.post("/api/admin/login",(req,res)=>{const e=norm(req.body.email).toLowerCase(),p=String(req.body.password||"");const a=db.admins.find(v=>v.email===e);if(!a||!bcrypt.compareSync(p,a.password_hash))return res.status(401).json({error:"Invalid email or password."});req.session.adminId=a.id;res.json({ok:true,email:a.email})});
app.post("/api/admin/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",(req,res)=>{if(!req.session.adminId)return res.json({loggedIn:false});const a=db.admins.find(v=>v.id===req.session.adminId);res.json({loggedIn:true,email:a.email})});
app.get("/api/admin/stats",auth,(req,res)=>res.json({students:db.students.length,subjects:db.marks.length,imports:db.import_logs.length}));
app.post("/api/admin/import",auth,upload.single("file"),(req,res)=>{if(!req.file)return res.status(400).json({error:"Select an Excel or CSV file."});try{const wb=XLSX.readFile(req.file.path),sh=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sh,{defval:""}),out=importRows(rows,req.file.originalname);fs.unlink(req.file.path,()=>{});res.json({ok:true,rows:rows.length,imported:out.good.length,invalid:out.bad,duplicates:out.dupes})}catch(e){fs.unlink(req.file.path,()=>{});res.status(400).json({error:"Invalid spreadsheet. Use .xlsx, .xls or .csv."})}});
app.post("/api/admin/import-url",auth,async(req,res)=>{const url=norm(req.body.url);if(!/^https?:\/\//i.test(url))return res.status(400).json({error:"Enter a valid public URL."});try{const rr=await fetch(url);if(!rr.ok)throw 0;const wb=XLSX.read(await rr.text(),{type:"string"}),sh=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sh,{defval:""}),out=importRows(rows,"Google Sheet URL");res.json({ok:true,rows:rows.length,imported:out.good.length,invalid:out.bad,duplicates:out.dupes})}catch(e){res.status(400).json({error:"Could not read the URL. Use a public CSV/export link."})}});
app.get("/api/admin/history",auth,(req,res)=>res.json(db.import_logs.slice(0,50)));
app.get("/api/admin/audit",auth,(req,res)=>res.json(db.audit_logs.slice(0,50)));
app.get("/api/admin/students",auth,(req,res)=>res.json([...db.students].sort((a,b)=>a.roll.localeCompare(b.roll))));
app.patch("/api/admin/student/:r/publish",auth,(req,res)=>{const r=roll(req.params.r),published=req.body.published?1:0,s=db.students.find(v=>v.roll===r);if(s)s.published=published;db.marks.filter(v=>v.roll===r).forEach(v=>v.published=published);save();audit(published?"PUBLISH":"UNPUBLISH",r);res.json({ok:true})});
app.delete("/api/admin/student/:r",auth,(req,res)=>{const r=roll(req.params.r);db.marks=db.marks.filter(v=>v.roll!==r);db.students=db.students.filter(v=>v.roll!==r);save();audit("DELETE",r);res.json({ok:true})});
app.get("/api/admin/template",auth,(req,res)=>{const rows=[{"Roll No":"CSE001","Name":"Demo Student","Subject":"Python","Midterm 1":18,"Midterm 2":19,"Assignment":10,"Semester":42,"Total":89,"Grade":"A","Result":"Pass","Class":"BTech CSE","Semester Name":"1"}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Marks");res.setHeader("Content-Disposition","attachment; filename=marks-template.xlsx");res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(XLSX.write(wb,{bookType:"xlsx",type:"buffer"}))});
app.listen(PORT,()=>console.log(`Student Marks Portal: http://localhost:${PORT}`));
