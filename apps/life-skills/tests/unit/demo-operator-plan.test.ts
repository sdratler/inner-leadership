import { describe,expect,test } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import { demoOperatorPlan } from '../../src/features/demo/operator-plan.ts';

const aliases={parent:'syntheticowner+demo-parent@gmail.com',child:'syntheticowner+demo-child@gmail.com',adult:'syntheticowner+demo-adult@gmail.com'};
const valid={batch:'ls-owner-20260926',ownerEmail:'SyntheticOwner@gmail.com',parentEmail:aliases.parent,childEmail:aliases.child,adultEmail:aliases.adult,
 setupRecipients:Object.values(aliases),childAccountsEnabled:true};

describe('owner demo operator plan',()=>{
 test('keeps three exact plus-addressed login identities distinct',()=>{
  const plan=demoOperatorPlan(valid);
  expect(plan.ownerEmail).toBe('syntheticowner@gmail.com');
  expect(plan.addresses).toEqual(aliases);
  expect(new Set(Object.values(plan.addresses)).size).toBe(3);
 });
 test('rejects an alias substitution or extra setup-mail recipient',()=>{
  expect(()=>demoOperatorPlan({...valid,childEmail:aliases.parent})).toThrow(AppError);
  expect(()=>demoOperatorPlan({...valid,setupRecipients:[...Object.values(aliases),'other@gmail.com']})).toThrow(AppError);
 });
 test('rejects disabled child accounts, changed batch and non-Gmail owner',()=>{
  expect(()=>demoOperatorPlan({...valid,childAccountsEnabled:false})).toThrow(AppError);
  expect(()=>demoOperatorPlan({...valid,batch:'other'})).toThrow(AppError);
  expect(()=>demoOperatorPlan({...valid,ownerEmail:'owner@example.invalid'})).toThrow(AppError);
 });
});
