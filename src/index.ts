import { JDpower } from "./service/jdpower";

async function main(){
  const jdpower = new JDpower('WMWLV7C00L2L81812');
  const data = await jdpower.getData();
  const result = jdpower.parseText(data);
  console.log(result);
}
main();