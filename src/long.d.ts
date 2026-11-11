// long@4 has no type declarations. Its public types are declared in types.ts (Long, LongConstructor), and the import
// is cast to them, so the published declarations don't depend on this file.
declare module 'long' {
	const Long: unknown
	export default Long
}
