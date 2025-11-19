/**  
 * Filters an array of items to keep only the first item that is checked (`isChecked: true`).  
 * All other items will have `isChecked` set to `false`.  
 *  
 * @param {Array<{ id: string; isChecked: boolean }>} items - An array of objects to filter,   
 * where each object has a unique identifier and a boolean indicating whether it is checked.  
 *   
 * @returns {Array<{ id: string; isChecked: boolean }>} A new array containing the filtered items.  
 * The first checked item retains its original value of `isChecked`, while all others are set to `false`.  
 *  
 * @example  
 * const items = [  
 *     { id: '1', isChecked: true },  
 *     { id: '2', isChecked: false },  
 *     { id: '3', isChecked: true },  
 *     { id: '4', isChecked: false }  
 * ];  
 *   
 * const filteredItems = filterItems(items);  
 * console.log(filteredItems);  
 * // Output: [{ id: '1', isChecked: true }, { id: '2', isChecked: false }, { id: '3', isChecked: false }, { id: '4', isChecked: false }]  
 */
export function filterItems(items: Array<{ id: string; isChecked: boolean }>): Array<{ id: string; isChecked: boolean }> {
    let foundChecked = false;

    return items.reduce((result, item) => {
        if (item.isChecked && !foundChecked) {
            foundChecked = true;
            result.push({ ...item }); // Add the first checked item  
        } else {
            result.push({ id: item.id, isChecked: false }); // Add others as unchecked  
        }
        return result;
    }, [] as Array<{ id: string; isChecked: boolean }>);
} 