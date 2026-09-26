import Foundation
import Security

// Removes only the retired Pokite executable from Claude Safe Storage ACLs.
// It never requests or returns the secret and never changes other applications.
let oldPath=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Pokite/Keychain/Pokite Claude Access").path
let apply=CommandLine.arguments.contains("--apply")
let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"Claude Safe Storage",kSecAttrAccount as String:"Claude",kSecReturnRef as String:true,kSecMatchLimit as String:kSecMatchLimitAll]
var result:CFTypeRef?
let status=SecItemCopyMatching(query as CFDictionary,&result)
guard status==errSecSuccess,let items=result as? [SecKeychainItem] else {print("No matching keychain items (status \(status))");exit(status==errSecItemNotFound ? 0:1)}
var removed=0
for item in items {
 var access:SecAccess?
 guard SecKeychainItemCopyAccess(item,&access)==errSecSuccess,let access else {fputs("Cannot inspect item access\n",stderr);exit(1)}
 var list:CFArray?
 guard SecAccessCopyACLList(access,&list)==errSecSuccess,let acls=list as? [SecACL] else {fputs("Cannot inspect ACL list\n",stderr);exit(1)}
 var changed=false
 for acl in acls {
  var applications:CFArray?,description:CFString?,prompt=SecKeychainPromptSelector()
  guard SecACLCopyContents(acl,&applications,&description,&prompt)==errSecSuccess else {fputs("Cannot read ACL\n",stderr);exit(1)}
  guard let apps=applications as? [SecTrustedApplication] else {continue}
  var keep:[SecTrustedApplication]=[]
  for app in apps {
   var data:CFData?
   guard SecTrustedApplicationCopyData(app,&data)==errSecSuccess,let data else {fputs("Cannot inspect trusted application\n",stderr);exit(1)}
   let bytes=data as Data
   let name=String(data:bytes.prefix{ $0 != 0 },encoding:.utf8)
   if name==oldPath {removed+=1;changed=true} else {keep.append(app)}
  }
  if keep.count != apps.count && apply {
   guard let description else {fputs("Cannot preserve ACL description\n",stderr);exit(1)}
   guard SecACLSetContents(acl,keep as CFArray,description,prompt)==errSecSuccess else {fputs("Cannot update ACL\n",stderr);exit(1)}
  }
 }
 if changed && apply {
  guard SecKeychainItemSetAccess(item,access)==errSecSuccess else {fputs("macOS did not authorize access-list update\n",stderr);exit(1)}
 }
}
print(apply ? "Removed retired Pokite authorization entries: \(removed)" : "Retired Pokite authorization entries to remove: \(removed)")
